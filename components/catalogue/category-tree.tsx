"use client";

import {
  AnimatePresence,
  MotionConfig,
  Reorder,
  motion,
  useDragControls,
  type PanInfo,
} from "framer-motion";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  CircleCheck,
  CornerDownRight,
  Ellipsis,
  FolderInput,
  FolderUp,
  GripVertical,
  LoaderCircle,
  Plus,
  X,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClassName } from "@/components/ui/button";
import { Dropdown, dropdownItemClassName } from "@/components/ui/dropdown";
import { Input } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import {
  arrangeCategories,
  createSubcategory,
  type ArrangeResult,
  type CategoryPlacement,
} from "@/lib/catalogue/actions";
import { NAME_MAX_LENGTH } from "@/lib/catalogue/validation";
import { format } from "@/lib/i18n/messages";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils/cn";
import { CatalogueImage } from "./catalogue-image";
import { CategoryDialog, type EditableCategory } from "./category-dialog";
import { StatusToggle } from "./status-toggle";

export type TreeCategory = EditableCategory & { productCount: number };

interface Group {
  main: TreeCategory;
  subs: TreeCategory[];
}

/** Drop target id for "make it a main category". */
const ROOT = "root";
/** Sort orders are renumbered in steps, leaving room for manual values in between. */
const STEP = 10;

function buildGroups(categories: TreeCategory[]): Group[] {
  const ids = new Set(categories.map((category) => category.id));
  // A subcategory whose parent isn't listed is shown as a main category.
  return categories
    .filter((category) => !category.parent_id || !ids.has(category.parent_id))
    .map((main) => ({
      main,
      subs: categories.filter((category) => category.parent_id === main.id),
    }));
}

/**
 * Renumbers the touched lists (ROOT = main categories, else a group's
 * subcategories) to match their on-screen order. Returns the updated groups
 * and only the categories whose order or parent actually changed.
 */
function arrange(groups: Group[], touched: Set<string>) {
  const changes: CategoryPlacement[] = [];
  const place = (item: TreeCategory, sortOrder: number, parentId: string | null) => {
    const moved = item.parent_id !== parentId;
    if (!moved && item.sort_order === sortOrder) return item;
    changes.push({ id: item.id, sortOrder, ...(moved ? { parentId } : {}) });
    return { ...item, sort_order: sortOrder, parent_id: parentId };
  };
  const next = groups.map((group, index) => {
    const main = touched.has(ROOT) ? place(group.main, (index + 1) * STEP, null) : group.main;
    const subs = touched.has(group.main.id)
      ? group.subs.map((sub, position) => place(sub, (position + 1) * STEP, main.id))
      : group.subs;
    return main === group.main && subs === group.subs ? group : { main, subs };
  });
  return { next, changes };
}

/** Case-insensitive name/slug match for the toolbar search. */
function matches(category: TreeCategory, q: string, status: string | null) {
  if (status === "active" && !category.is_active) return false;
  if (status === "inactive" && category.is_active) return false;
  if (!q) return true;
  const needle = q.toLocaleLowerCase();
  return (
    category.name.toLocaleLowerCase().includes(needle) ||
    category.slug.toLocaleLowerCase().includes(needle)
  );
}

/**
 * Drag-and-drop category structure: main categories as cards, their
 * subcategories inside. Drag a card to reorder main categories; drag a
 * subcategory to reorder it, into another card to move it there, or onto the
 * bottom bar to make it a main category. Every change is shown at once and
 * saved in the background (in order); a failed save restores the saved order.
 * Each row's menu offers the same moves without dragging (keyboard, touch).
 */
export function CategoryTree({ categories }: { categories: TreeCategory[] }) {
  const { messages } = useI18n();
  const t = messages.catalogue.categories.tree;
  const toast = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [groups, setGroupsState] = useState(() => buildGroups(categories));
  const latest = useRef(groups);
  const setGroups = (next: Group[]) => {
    latest.current = next;
    setGroupsState(next);
  };
  const [saving, setSaving] = useState(0);
  const [saved, setSaved] = useState(false);
  // Fresh server data replaces local state, but not mid-save (an earlier
  // save's refresh would briefly undo the later, still unsaved moves).
  const [synced, setSynced] = useState<TreeCategory[] | null>(categories);
  if (categories !== synced && saving === 0) {
    setSynced(categories);
    setGroupsState(buildGroups(categories));
  }
  // Event handlers read the latest structure, even between renders.
  useLayoutEffect(() => {
    latest.current = groups;
  }, [groups]);
  const queue = useRef<Promise<void>>(Promise.resolve());

  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [draggingSub, setDraggingSub] = useState<string | null>(null);
  const [dropTarget, setDropTargetState] = useState<string | null>(null);
  const dropTargetRef = useRef<string | null>(null);
  const setDropTarget = (value: string | null) => {
    if (dropTargetRef.current === value) return;
    dropTargetRef.current = value;
    setDropTargetState(value);
  };

  const q = (searchParams.get("q") ?? "").trim();
  const status = searchParams.get("status");
  const level = searchParams.get("level");
  const filtered = Boolean(q) || Boolean(status) || Boolean(level);
  const visible: Group[] = filtered
    ? groups.flatMap((group) => {
        const subs = level === "main" ? [] : group.subs.filter((sub) => matches(sub, q, status));
        const mainMatches = level !== "sub" && matches(group.main, q, status);
        return mainMatches || subs.length > 0 ? [{ main: group.main, subs }] : [];
      })
    : groups;

  const nameOf = (id: string) => groups.find((group) => group.main.id === id)?.main.name ?? "";
  const parents = groups.map(({ main }) => ({ id: main.id, name: main.name }));

  function saveError(result: Extract<ArrangeResult, { ok: false }>) {
    if (result.error === "parentHasChildren" || result.error === "parentInvalid") {
      return messages.catalogue.errors[result.error];
    }
    return result.error === "forbidden" ? messages.catalogue.errors.forbidden : t.saveFailed;
  }

  /** Shows the change now and saves it after any earlier saves. */
  function commit(next: Group[], touched: Set<string>, done?: string) {
    const { next: arranged, changes } = arrange(next, touched);
    setGroups(arranged);
    if (changes.length === 0) return;
    setSaving((count) => count + 1);
    queue.current = queue.current.then(async () => {
      let result: ArrangeResult;
      try {
        result = await arrangeCategories(changes);
      } catch {
        result = { ok: false, error: "network" };
      }
      if (result.ok) {
        setSaved(true);
        if (done) toast.success(done);
      } else {
        toast.error(saveError(result));
        // Re-sync with the saved structure once the queue is idle.
        setSynced(null);
        router.refresh();
      }
      setSaving((count) => count - 1);
    });
  }

  function moveSub(subId: string, fromId: string, toId: string, index?: number) {
    const current = latest.current;
    const from = current.find((group) => group.main.id === fromId);
    const sub = from?.subs.find((item) => item.id === subId);
    if (!from || !sub || fromId === toId) return;
    const without = current.map((group) =>
      group === from ? { ...group, subs: group.subs.filter((item) => item !== sub) } : group,
    );
    if (toId === ROOT) {
      const at = without.findIndex((group) => group.main.id === fromId) + 1;
      const next = [...without.slice(0, at), { main: sub, subs: [] }, ...without.slice(at)];
      commit(next, new Set([ROOT, fromId]), format(t.madeMain, { name: sub.name }));
      return;
    }
    const next = without.map((group) => {
      if (group.main.id !== toId) return group;
      const subs = [...group.subs];
      subs.splice(index ?? subs.length, 0, sub);
      return { ...group, subs };
    });
    expand(toId);
    commit(
      next,
      new Set([fromId, toId]),
      format(t.movedInto, { name: sub.name, parent: nameOf(toId) }),
    );
  }

  /** A main category without subcategories becomes a subcategory of another. */
  function moveMainInto(mainId: string, toId: string) {
    const current = latest.current;
    const group = current.find((item) => item.main.id === mainId);
    if (!group || group.subs.length > 0 || mainId === toId) return;
    const next = current
      .filter((item) => item !== group)
      .map((item) =>
        item.main.id === toId ? { ...item, subs: [...item.subs, group.main] } : item,
      );
    expand(toId);
    commit(
      next,
      new Set([ROOT, toId]),
      format(t.movedInto, { name: group.main.name, parent: nameOf(toId) }),
    );
  }

  /** Moves a category one place up or down among its siblings. */
  function moveBy(id: string, delta: -1 | 1) {
    const current = latest.current;
    const swap = <T,>(list: T[], index: number) => {
      const target = index + delta;
      if (index < 0 || target < 0 || target >= list.length) return null;
      const copy = [...list];
      [copy[index], copy[target]] = [copy[target], copy[index]];
      return copy;
    };
    const mainIndex = current.findIndex((group) => group.main.id === id);
    if (mainIndex >= 0) {
      const next = swap(current, mainIndex);
      if (next) commit(next, new Set([ROOT]));
      return;
    }
    const owner = current.find((group) => group.subs.some((sub) => sub.id === id));
    if (!owner) return;
    const subs = swap(
      owner.subs,
      owner.subs.findIndex((sub) => sub.id === id),
    );
    if (!subs) return;
    commit(
      current.map((group) => (group === owner ? { ...group, subs } : group)),
      new Set([owner.main.id]),
    );
  }

  function expand(id: string) {
    setCollapsed((set) => {
      if (!set.has(id)) return set;
      const next = new Set(set);
      next.delete(id);
      return next;
    });
  }

  function toggle(id: string) {
    setCollapsed((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** The drop zone under the pointer (ignoring the dragged row itself). */
  function zoneAt(point: PanInfo["point"], dragged: HTMLElement | null) {
    const hit = document
      .elementsFromPoint(point.x - window.scrollX, point.y - window.scrollY)
      .find((element) => !dragged?.contains(element) && element.closest("[data-drop]"));
    return hit?.closest<HTMLElement>("[data-drop]")?.dataset.drop ?? null;
  }

  function onSubDrag(groupId: string, point: PanInfo["point"], dragged: HTMLElement | null) {
    const zone = zoneAt(point, dragged);
    setDropTarget(zone === groupId ? null : zone);
  }

  function onSubDragEnd(subId: string, groupId: string, point: PanInfo["point"]) {
    const target = dropTargetRef.current;
    setDropTarget(null);
    setDraggingSub(null);
    if (target === ROOT) return moveSub(subId, groupId, ROOT);
    if (target) {
      // Insert where it was dropped: after the rows whose middle is above the pointer.
      const rows = collapsed.has(target)
        ? null
        : document.querySelectorAll(`[data-drop="${target}"] [data-sub-row]`);
      const y = point.y - window.scrollY;
      const index = rows
        ? [...rows].filter((row) => {
            const box = row.getBoundingClientRect();
            return box.top + box.height / 2 < y;
          }).length
        : undefined;
      return moveSub(subId, groupId, target, index);
    }
    commit(latest.current, new Set([groupId]));
  }

  const allCollapsed = groups.every(
    (group) => group.subs.length === 0 || collapsed.has(group.main.id),
  );

  return (
    <MotionConfig reducedMotion="user" transition={{ type: "spring", stiffness: 500, damping: 40 }}>
      <section aria-label={t.label} className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-2xl border border-dashed bg-card/60 px-4 py-3 text-sm text-muted-foreground">
          <p className="flex min-w-0 flex-1 items-start gap-2">
            <GripVertical aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span>{filtered ? t.filteredHint : t.hint}</span>
          </p>
          <div className="flex items-center gap-3">
            <span role="status" aria-live="polite" className="flex items-center gap-1.5 text-xs">
              {saving > 0 ? (
                <>
                  <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
                  {t.saving}
                </>
              ) : saved ? (
                <>
                  <CircleCheck aria-hidden className="size-3.5 text-success" />
                  {t.saved}
                </>
              ) : null}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setCollapsed(
                  allCollapsed ? new Set() : new Set(groups.map((group) => group.main.id)),
                )
              }
            >
              {allCollapsed ? t.expandAll : t.collapseAll}
            </Button>
          </div>
        </div>

        <Reorder.Group
          as="ol"
          axis="y"
          values={visible}
          onReorder={(next) => !filtered && setGroups(next)}
          className="grid gap-3"
        >
          {visible.map((group, index) => (
            <GroupCard
              key={group.main.id}
              group={group}
              locked={filtered}
              first={index === 0}
              last={index === visible.length - 1}
              open={!collapsed.has(group.main.id) || filtered}
              highlighted={dropTarget === group.main.id}
              parents={parents}
              onToggle={() => toggle(group.main.id)}
              onDragEnd={() => commit(latest.current, new Set([ROOT]))}
              onReorderSubs={(subs) =>
                setGroups(
                  latest.current.map((item) =>
                    item.main.id === group.main.id ? { ...item, subs } : item,
                  ),
                )
              }
              onSubDragStart={(id) => setDraggingSub(id)}
              onSubDrag={(point, dragged) => onSubDrag(group.main.id, point, dragged)}
              onSubDragEnd={(id, point) => onSubDragEnd(id, group.main.id, point)}
              onMoveBy={moveBy}
              onMoveSub={(id, toId) => moveSub(id, group.main.id, toId)}
              onMoveMainInto={(toId) => moveMainInto(group.main.id, toId)}
            />
          ))}
        </Reorder.Group>

        {visible.length === 0 && (
          <p className="rounded-2xl border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
            {messages.catalogue.common.noResultsBody}
          </p>
        )}
      </section>

      {/* Floating target while a subcategory is dragged: drop to make it a main category. */}
      <AnimatePresence>
        {draggingSub && (
          <motion.div
            data-drop={ROOT}
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0, scale: dropTarget === ROOT ? 1.03 : 1 }}
            exit={{ opacity: 0, y: 24 }}
            className={cn(
              "fixed inset-x-4 bottom-6 z-40 mx-auto flex max-w-md items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-4 text-sm font-medium shadow-card backdrop-blur",
              dropTarget === ROOT
                ? "border-brand bg-brand-soft text-brand-soft-foreground"
                : "border-border bg-card/90 text-muted-foreground",
            )}
          >
            <FolderUp aria-hidden className="size-4" />
            {t.dropToMain}
          </motion.div>
        )}
      </AnimatePresence>
    </MotionConfig>
  );
}

/** Drag handle: starts the drag on press; arrow keys move one place. */
function Handle({
  label,
  onStart,
  onMoveBy,
}: {
  label: string;
  onStart: (event: ReactPointerEvent) => void;
  onMoveBy: (delta: -1 | 1) => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onPointerDown={(event) => {
        event.preventDefault();
        onStart(event);
      }}
      onKeyDown={(event: KeyboardEvent) => {
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        event.preventDefault();
        onMoveBy(event.key === "ArrowUp" ? -1 : 1);
      }}
      className="flex size-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:cursor-grabbing"
    >
      <GripVertical aria-hidden className="size-4" />
    </button>
  );
}

function GroupCard({
  group,
  locked,
  first,
  last,
  open,
  highlighted,
  parents,
  onToggle,
  onDragEnd,
  onReorderSubs,
  onSubDragStart,
  onSubDrag,
  onSubDragEnd,
  onMoveBy,
  onMoveSub,
  onMoveMainInto,
}: {
  group: Group;
  /** Filtered view: no dragging or moving. */
  locked: boolean;
  first: boolean;
  last: boolean;
  open: boolean;
  /** A dragged subcategory is over this card. */
  highlighted: boolean;
  parents: { id: string; name: string }[];
  onToggle: () => void;
  onDragEnd: () => void;
  onReorderSubs: (subs: TreeCategory[]) => void;
  onSubDragStart: (id: string) => void;
  onSubDrag: (point: PanInfo["point"], dragged: HTMLElement | null) => void;
  onSubDragEnd: (id: string, point: PanInfo["point"]) => void;
  onMoveBy: (id: string, delta: -1 | 1) => void;
  onMoveSub: (id: string, toId: string) => void;
  onMoveMainInto: (toId: string) => void;
}) {
  const { messages } = useI18n();
  const t = messages.catalogue.categories.tree;
  const controls = useDragControls();
  const { main, subs } = group;
  const others = parents.filter((parent) => parent.id !== main.id);

  return (
    <Reorder.Item
      value={group}
      dragListener={false}
      dragControls={controls}
      onDragEnd={onDragEnd}
      data-drop={main.id}
      whileDrag={{ scale: 1.01, boxShadow: "0 18px 40px -16px rgb(0 0 0 / 0.35)" }}
      className={cn(
        "relative rounded-2xl border bg-card transition-[border-color,background-color,box-shadow] duration-200",
        highlighted && "border-brand bg-brand-soft/30 ring-2 ring-brand/30",
      )}
    >
      <div className="flex items-center gap-2 p-2 sm:gap-3 sm:p-3">
        {!locked && (
          <Handle
            label={format(t.dragHandle, { name: main.name })}
            onStart={(event) => controls.start(event)}
            onMoveBy={(delta) => onMoveBy(main.id, delta)}
          />
        )}
        <button
          type="button"
          onClick={onToggle}
          disabled={locked || subs.length === 0}
          aria-expanded={open}
          aria-label={format(open ? t.collapse : t.expand, { name: main.name })}
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
        >
          <motion.span animate={{ rotate: open ? 0 : -90 }} className="flex">
            <ChevronDown aria-hidden className="size-4" />
          </motion.span>
        </button>
        <span className="hidden sm:block">
          <CatalogueImage src={main.image_url} alt="" sizes="44px" className="size-11" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <bdi className="truncate font-semibold">{main.name}</bdi>
            {!main.is_active && <Badge>{t.inactive}</Badge>}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {format(t.subcategoryCount, { count: subs.length })}
            <span aria-hidden> · </span>
            {format(t.productCount, { count: main.productCount })}
          </p>
        </div>
        <AnimatePresence>
          {highlighted && (
            <motion.span
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="hidden items-center gap-1.5 rounded-full bg-brand px-3 py-1 text-xs font-medium text-brand-foreground md:flex"
            >
              <FolderInput aria-hidden className="size-3.5" />
              {format(t.dropHere, { name: main.name })}
            </motion.span>
          )}
        </AnimatePresence>
        <RowActions
          category={main}
          parents={parents}
          hasChildren={subs.length > 0}
          locked={locked}
          first={first}
          last={last}
          onMoveBy={(delta) => onMoveBy(main.id, delta)}
          moveTargets={subs.length > 0 ? null : others}
          onMoveInto={onMoveMainInto}
        />
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="subs"
            initial={{ height: 0, opacity: 0, overflow: "hidden" }}
            animate={{ height: "auto", opacity: 1, transitionEnd: { overflow: "visible" } }}
            exit={{ height: 0, opacity: 0, overflow: "hidden" }}
          >
            <div className="border-t px-2 pt-2 pb-2 sm:px-3">
              <Reorder.Group
                as="ul"
                axis="y"
                values={subs}
                onReorder={(next) => !locked && onReorderSubs(next)}
                className="grid gap-1 border-s-2 border-dashed border-border ps-2 sm:ms-[3.25rem] sm:ps-3"
              >
                <AnimatePresence initial={false}>
                  {subs.map((sub, index) => (
                    <SubRow
                      key={sub.id}
                      sub={sub}
                      locked={locked}
                      first={index === 0}
                      last={index === subs.length - 1}
                      parents={parents}
                      parentId={main.id}
                      onDragStart={() => onSubDragStart(sub.id)}
                      onDrag={onSubDrag}
                      onDragEnd={(point) => onSubDragEnd(sub.id, point)}
                      onMoveBy={(delta) => onMoveBy(sub.id, delta)}
                      onMoveInto={(toId) => onMoveSub(sub.id, toId)}
                    />
                  ))}
                </AnimatePresence>
                {subs.length === 0 && (
                  <li className="rounded-xl border border-dashed px-3 py-3 text-xs text-muted-foreground">
                    {t.noSubcategories}
                  </li>
                )}
              </Reorder.Group>
              {!locked && (
                <div className="sm:ms-[3.25rem]">
                  <AddSubcategory parent={main} subs={subs} />
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Reorder.Item>
  );
}

function SubRow({
  sub,
  locked,
  first,
  last,
  parents,
  parentId,
  onDragStart,
  onDrag,
  onDragEnd,
  onMoveBy,
  onMoveInto,
}: {
  sub: TreeCategory;
  locked: boolean;
  first: boolean;
  last: boolean;
  parents: { id: string; name: string }[];
  parentId: string;
  onDragStart: () => void;
  onDrag: (point: PanInfo["point"], dragged: HTMLElement | null) => void;
  onDragEnd: (point: PanInfo["point"]) => void;
  onMoveBy: (delta: -1 | 1) => void;
  onMoveInto: (toId: string) => void;
}) {
  const { messages } = useI18n();
  const t = messages.catalogue.categories.tree;
  const controls = useDragControls();
  const ref = useRef<HTMLLIElement>(null);

  return (
    <Reorder.Item
      ref={ref}
      value={sub}
      layoutId={sub.id}
      data-sub-row
      dragListener={false}
      dragControls={controls}
      onDragStart={onDragStart}
      onDrag={(_, info) => onDrag(info.point, ref.current)}
      onDragEnd={(_, info) => onDragEnd(info.point)}
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      whileDrag={{ scale: 1.03, boxShadow: "0 18px 40px -16px rgb(0 0 0 / 0.4)" }}
      className="relative flex items-center gap-2 rounded-xl bg-card px-1 py-1 transition-colors hover:bg-accent/60 sm:gap-3"
    >
      {!locked && (
        <Handle
          label={format(t.dragHandle, { name: sub.name })}
          onStart={(event) => controls.start(event)}
          onMoveBy={onMoveBy}
        />
      )}
      <CornerDownRight
        aria-hidden
        className="hidden size-3.5 shrink-0 text-muted-foreground sm:block rtl:-scale-x-100"
      />
      <span className="hidden sm:block">
        <CatalogueImage src={sub.image_url} alt="" sizes="32px" className="size-8" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <bdi className="truncate font-medium">{sub.name}</bdi>
          {!sub.is_active && <Badge>{t.inactive}</Badge>}
        </p>
        <p className="text-xs text-muted-foreground">
          {format(t.productCount, { count: sub.productCount })}
        </p>
      </div>
      <RowActions
        category={sub}
        parents={parents}
        hasChildren={false}
        locked={locked}
        first={first}
        last={last}
        onMoveBy={onMoveBy}
        moveTargets={parents.filter((parent) => parent.id !== parentId)}
        onMoveInto={onMoveInto}
        canMakeMain
      />
    </Reorder.Item>
  );
}

/** Move menu (no-drag alternative), Edit and Activate/Deactivate. */
function RowActions({
  category,
  parents,
  hasChildren,
  locked,
  first,
  last,
  onMoveBy,
  moveTargets,
  onMoveInto,
  canMakeMain = false,
}: {
  category: TreeCategory;
  parents: { id: string; name: string }[];
  hasChildren: boolean;
  locked: boolean;
  first: boolean;
  last: boolean;
  onMoveBy: (delta: -1 | 1) => void;
  /** Categories it can move into; null = it has subcategories (stays main). */
  moveTargets: { id: string; name: string }[] | null;
  onMoveInto: (toId: string) => void;
  canMakeMain?: boolean;
}) {
  const { messages } = useI18n();
  const t = messages.catalogue.categories.tree;

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {!locked && (
        <Dropdown
          label={format(t.moveMenu, { name: category.name })}
          trigger={<Ellipsis aria-hidden />}
          triggerClassName={buttonClassName({ variant: "ghost", size: "icon-sm" })}
          panelClassName="max-h-80 overflow-y-auto"
        >
          {(close) => {
            const run = (action: () => void) => () => {
              close();
              action();
            };
            return (
              <>
                <button
                  type="button"
                  disabled={first}
                  onClick={run(() => onMoveBy(-1))}
                  className={dropdownItemClassName}
                >
                  <ArrowUp aria-hidden />
                  {t.moveUp}
                </button>
                <button
                  type="button"
                  disabled={last}
                  onClick={run(() => onMoveBy(1))}
                  className={dropdownItemClassName}
                >
                  <ArrowDown aria-hidden />
                  {t.moveDown}
                </button>
                {canMakeMain && (
                  <button
                    type="button"
                    onClick={run(() => onMoveInto(ROOT))}
                    className={dropdownItemClassName}
                  >
                    <FolderUp aria-hidden />
                    {t.makeMain}
                  </button>
                )}
                <div role="separator" className="my-1.5 border-t" />
                <p className="caps px-3 pt-1 pb-1.5 text-[0.625rem] text-muted-foreground">
                  {t.moveInto}
                </p>
                {moveTargets === null ? (
                  <p className="px-3 pb-2 text-xs text-muted-foreground">{t.moveIntoLocked}</p>
                ) : (
                  moveTargets.map((target) => (
                    <button
                      key={target.id}
                      type="button"
                      onClick={run(() => onMoveInto(target.id))}
                      className={dropdownItemClassName}
                    >
                      <FolderInput aria-hidden />
                      <bdi className="truncate">{target.name}</bdi>
                    </button>
                  ))
                )}
              </>
            );
          }}
        </Dropdown>
      )}
      <CategoryDialog compact category={category} parents={parents} hasChildren={hasChildren} />
      <StatusToggle
        compact
        kind="category"
        id={category.id}
        name={category.name}
        active={category.is_active}
      />
    </div>
  );
}

/** Inline "+ Add subcategory": a name field that creates it at the end of the list. */
function AddSubcategory({ parent, subs }: { parent: TreeCategory; subs: TreeCategory[] }) {
  const { messages } = useI18n();
  const t = messages.catalogue.categories.tree;
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();

  function submit() {
    const value = name.trim();
    if (!value || pending) return;
    const last = Math.max(0, ...subs.map((sub) => sub.sort_order));
    startTransition(async () => {
      const result = await createSubcategory(parent.id, value, last + STEP);
      if (!result.ok) {
        toast.error(messages.catalogue.errors[result.error]);
        return;
      }
      toast.success(format(t.subcategoryCreated, { name: result.name, parent: parent.name }));
      setName("");
    });
  }

  if (!adding) {
    return (
      <Button variant="ghost" size="sm" className="mt-1.5" onClick={() => setAdding(true)}>
        <Plus aria-hidden />
        {t.addSubcategory}
      </Button>
    );
  }

  return (
    <motion.form
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="mt-2 flex items-center gap-2"
    >
      <label className="min-w-0 flex-1">
        <span className="sr-only">{format(t.newSubcategoryLabel, { name: parent.name })}</span>
        <Input
          autoFocus
          value={name}
          maxLength={NAME_MAX_LENGTH}
          disabled={pending}
          placeholder={t.newSubcategoryPlaceholder}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setAdding(false);
              setName("");
            }
          }}
        />
      </label>
      <Button type="submit" size="sm" disabled={pending || !name.trim()} aria-busy={pending}>
        {pending ? <LoaderCircle aria-hidden className="animate-spin" /> : <Plus aria-hidden />}
        {t.add}
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={messages.catalogue.common.cancel}
        onClick={() => {
          setAdding(false);
          setName("");
        }}
      >
        <X aria-hidden />
      </Button>
    </motion.form>
  );
}
