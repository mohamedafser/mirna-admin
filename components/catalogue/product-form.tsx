"use client";

import { History, LoaderCircle, Save } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { Button, buttonClassName } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Field, Input, Textarea } from "@/components/ui/form";
import { StockStatusBadge } from "@/components/inventory/stock-status-badge";
import { useToast } from "@/components/ui/toast";
import {
  saveProduct,
  setPrimaryProductImage,
  uploadProductImage,
  type ProductFormResult,
} from "@/lib/catalogue/actions";
import {
  readProductAttributes,
  validateProductAttributes,
  type AttributeCatalog,
  type ProductAttributeError,
  type SavedProductAttributes,
} from "@/lib/attributes/rules";
import { validateImageFile } from "@/lib/catalogue/images";
import type { Currency } from "@/lib/currency/money";
import { CURRENCY_PRICES_FIELD, readCurrencyPrices } from "@/lib/currency/product-prices";
import type { ProductTaxonomy, TagOption } from "@/lib/catalogue/queries";
import { slugify } from "@/lib/catalogue/slug";
import {
  NAME_MAX_LENGTH,
  PRODUCT_DESCRIPTION_MAX_LENGTH,
  readProduct,
  SHORT_DESCRIPTION_MAX_LENGTH,
  SKU_MAX_LENGTH,
  validateProduct,
  type CatalogueFieldError,
  type ProductFieldErrors,
} from "@/lib/catalogue/validation";
import { format } from "@/lib/i18n/messages";
import { useI18n } from "@/lib/i18n/client";
import { parseWholeNumber, stockStatus } from "@/lib/inventory/rules";
import { currencyFractionDigits, moneyInputValue } from "@/lib/money";
import { ImageDropzone } from "./image-dropzone";
import { ImageGallery } from "./image-gallery";
import { Panel } from "./panel";
import { useUnsavedChanges } from "./use-unsaved-changes";
import { CategoryPicker, type CategoryChoice } from "./category-picker";
import { ProductAttributes } from "./product-attributes";
import { PriceTable } from "./price-table";
import { ProductTaxonomyFields } from "./product-taxonomy";

export interface EditableProduct {
  id: string;
  name: string;
  slug: string;
  sku: string;
  category_id: string | null;
  short_description: string | null;
  description: string | null;
  price: number | string;
  compare_at_price: number | string | null;
  currency_code: string;
  is_active: boolean;
  updated_at: string;
  /** null when the product has no inventory row yet (saving creates it). */
  inventory: {
    quantity: number;
    reserved: number;
    threshold: number;
    updatedAt: string;
  } | null;
  /** Product type + attribute values (null: attribute tables not set up yet). */
  attributes: SavedProductAttributes | null;
  /** > 0: stock is managed per variant (the product row is their total). */
  variantCount: number;
  /** Category (main included) and tag ids (null: tag tables not set up yet). */
  taxonomy: ProductTaxonomy | null;
}

/** Product and stock are versioned separately; either change reloads the form. */
const versionOf = (product: EditableProduct) =>
  `${product.updated_at}|${product.inventory?.updatedAt ?? ""}`;

/** An image chosen on the "new product" page, uploaded when the product is saved. */
interface PendingImage {
  key: string;
  file: File;
  /** Object URL preview (revoked when removed or after upload). */
  src: string;
  alt: string;
  isPrimary: boolean;
}

interface ProductFormProps {
  product?: EditableProduct;
  categories: CategoryChoice[];
  currencies: readonly string[];
  defaultCurrency: string;
  /**
   * The store's currencies (null until migration 031 is applied: the form
   * keeps its single price). With them, pricing is a table per currency.
   */
  priceCurrencies?: Currency[] | null;
  /** The product's product-level prices in minor units, by currency code. */
  prices?: Record<string, { price: number; salePrice: number | null }>;
  /** Product types and attributes (null until migration 023 is applied). */
  attributeCatalog: AttributeCatalog | null;
  /** Every tag (null until migration 027 is applied: tag fields hidden). */
  tags: TagOption[] | null;
  /** Side column content for an existing product (its image manager). */
  aside?: ReactNode;
  /** New product: the next generated SKU, filled in as the default. */
  suggestedSku?: string | null;
}

const initialState: ProductFormResult = { status: "idle", fieldErrors: {}, at: 0 };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="grid gap-4 rounded-2xl border bg-card p-4 sm:p-5">
      <legend className="float-start mb-1 w-full text-sm font-semibold">{title}</legend>
      {children}
    </fieldset>
  );
}

/**
 * Create / edit product, including its stock and low-stock threshold. Stock
 * is saved as a "set" adjustment (stock history records it); the Inventory
 * page offers increase/decrease with a reason.
 *
 * Images: on a new product they are chosen up front and uploaded right after
 * the product is created (Storage paths need the product id). On an existing
 * product the page passes the live image manager as `aside`.
 *
 * Concurrency: the form edits the version (updated_at) it was loaded with.
 * When the server re-renders a newer version (own save, status toggle,
 * another admin) and there are no unsaved edits, the fields reload from it.
 * With unsaved edits they are kept, and saving reports the conflict rather
 * than overwriting someone else's change.
 */
export function ProductForm(props: ProductFormProps) {
  const { product } = props;
  const [snapshot, setSnapshot] = useState(product);
  const [dirty, setDirty] = useState(false);
  useUnsavedChanges(dirty);

  if (product && snapshot && versionOf(product) !== versionOf(snapshot) && !dirty) {
    setSnapshot(product);
  }

  return (
    <ProductFormFields
      key={snapshot ? versionOf(snapshot) : "new"}
      {...props}
      product={snapshot}
      dirty={dirty}
      setDirty={setDirty}
    />
  );
}

function ProductFormFields({
  product,
  categories,
  currencies,
  defaultCurrency,
  priceCurrencies = null,
  prices = {},
  attributeCatalog,
  tags,
  aside,
  suggestedSku = null,
  dirty,
  setDirty,
}: ProductFormProps & { dirty: boolean; setDirty: (dirty: boolean) => void }) {
  const { locale, messages } = useI18n();
  const t = messages.catalogue;
  const f = t.products.fields;
  const router = useRouter();
  const toast = useToast();
  const [state, setState] = useState(initialState);
  const [pending, startTransition] = useTransition();
  const [clientErrors, setClientErrors] = useState<ProductFieldErrors | null>(null);
  const [clientAttributeErrors, setClientAttributeErrors] = useState<Record<
    string,
    ProductAttributeError
  > | null>(null);
  const [name, setName] = useState(product?.name ?? "");
  const [slug, setSlug] = useState(product?.slug ?? "");
  // An existing slug, or one the admin typed, is never overwritten by the name.
  const [slugTouched, setSlugTouched] = useState(Boolean(product));
  // Products are based in the store currency (Settings) when it's an active
  // currency: new ones start in it, and an existing product in another
  // currency is switched to it on save (the Base tag shows it). Without
  // it: the product's own currency, else the Currencies page default.
  const storeCurrencyActive = priceCurrencies?.some(
    (option) => option.code === defaultCurrency && option.isActive,
  );
  const [currency, setCurrency] = useState(
    !priceCurrencies || storeCurrencyActive
      ? product && !priceCurrencies
        ? product.currency_code
        : defaultCurrency
      : (product?.currency_code ??
          priceCurrencies.find((option) => option.isDefault)?.code ??
          defaultCurrency),
  );
  const [images, setImages] = useState<PendingImage[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const loadedStock = product?.inventory?.quantity ?? 0;
  const reserved = product?.inventory?.reserved ?? 0;
  const [stock, setStock] = useState(String(loadedStock));
  const [threshold, setThreshold] = useState(String(product?.inventory?.threshold ?? 0));
  const [mainCategoryId, setMainCategoryId] = useState(product?.category_id ?? "");
  // After a save attempt the price table also flags rows not edited yet.
  const [pricesChecked, setPricesChecked] = useState(false);
  const id = useId();
  const formId = `${id}-form`;

  const fieldErrors = clientErrors ?? state.fieldErrors;
  const attributeErrors = clientAttributeErrors ?? state.attributeErrors ?? {};
  const errorText = (code?: CatalogueFieldError) => {
    if (!code) return undefined;
    if (code === "slugTaken") return t.products.slugTaken;
    if (code === "stockBelowReserved") return format(t.errors.stockBelowReserved, { reserved });
    if (code === "moneyTooManyDecimals") {
      return format(t.errors.moneyTooManyDecimals, { digits: currencyFractionDigits(currency) });
    }
    return t.errors[code];
  };

  // --- Pending images (new product) -----------------------------------------
  function addImages(files: File[]) {
    const added: PendingImage[] = [];
    for (const file of files) {
      const error = validateImageFile(file);
      if (error) {
        toast.error(`${file.name}: ${t.errors[error]}`);
        continue;
      }
      added.push({
        key: crypto.randomUUID(),
        file,
        src: URL.createObjectURL(file),
        alt: "",
        isPrimary: false,
      });
    }
    if (added.length === 0) return;
    setImages((current) => {
      const next = [...current, ...added];
      if (!next.some((image) => image.isPrimary)) next[0] = { ...next[0], isPrimary: true };
      return next;
    });
    setDirty(true);
  }

  function removeImage(key: string) {
    setImages((current) => {
      const removed = current.find((image) => image.key === key);
      if (removed) URL.revokeObjectURL(removed.src);
      const next = current.filter((image) => image.key !== key);
      if (removed?.isPrimary && next.length > 0) next[0] = { ...next[0], isPrimary: true };
      return next;
    });
  }

  function moveImage(key: string, offset: -1 | 1) {
    setImages((current) => {
      const next = [...current];
      const index = next.findIndex((image) => image.key === key);
      [next[index], next[index + offset]] = [next[index + offset], next[index]];
      return next;
    });
  }

  /** Uploads pending images in order; returns how many failed. */
  async function uploadPending(productId: string): Promise<number> {
    let failed = 0;
    let chosenPrimaryId: string | null = null;
    for (const [index, image] of images.entries()) {
      setProgress({ done: index, total: images.length });
      const data = new FormData();
      data.set("file", image.file);
      data.set("alt", image.alt);
      const result = await uploadProductImage(productId, data);
      if (!result.ok) failed += 1;
      // The first stored image becomes primary automatically; honour another choice.
      else if (image.isPrimary && index - failed > 0) chosenPrimaryId = result.imageId;
    }
    if (chosenPrimaryId) await setPrimaryProductImage(chosenPrimaryId);
    for (const image of images) URL.revokeObjectURL(image.src);
    return failed;
  }

  // --- Submit -----------------------------------------------------------------
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const errors = validateProduct(readProduct(data), reserved, { skuOptional: !product });
    // Prices in other currencies (the base currency is the product's own price above).
    const priceIssues = priceCurrencies
      ? Object.keys(
          readCurrencyPrices(
            String(data.get(CURRENCY_PRICES_FIELD) ?? ""),
            priceCurrencies,
            currency,
          ).errors,
        )
      : [];
    let attributeIssues: Record<string, ProductAttributeError> = {};
    if (attributeCatalog) {
      const input = readProductAttributes(data);
      const checked = validateProductAttributes(
        input.productTypeId,
        input.entries,
        attributeCatalog,
        product?.attributes ?? null,
      );
      if (checked.typeError) errors.productTypeId = checked.typeError;
      attributeIssues = checked.errors;
    }
    const firstAttribute = Object.keys(attributeIssues)[0];
    setPricesChecked(true);
    if (Object.keys(errors).length > 0 || firstAttribute || priceIssues.length > 0) {
      setClientErrors(errors);
      setClientAttributeErrors(attributeIssues);
      if (
        priceCurrencies &&
        (errors.price || errors.compareAtPrice || (!Object.keys(errors)[0] && !firstAttribute))
      ) {
        // The price table: the base row's fields, else the first row with a problem.
        const code = errors.price || errors.compareAtPrice ? currency : priceIssues[0];
        form.querySelector<HTMLElement>(`[data-price-currency="${code}"]`)?.focus();
        return;
      }
      const first = Object.keys(errors)[0] ?? firstAttribute;
      // Custom dropdowns are found by data-field (their hidden input can't take focus).
      form
        .querySelector<HTMLElement>(
          `[data-field="${first}"], [name="${first}"], [data-attribute="${first}"]`,
        )
        ?.focus();
      return;
    }
    setClientErrors(null);
    setClientAttributeErrors(null);
    startTransition(async () => {
      const result = await saveProduct(state, data);
      setState(result);
      if (result.status !== "success") return;

      if (result.mode === "created" && result.id) {
        const failed = images.length > 0 ? await uploadPending(result.id) : 0;
        setDirty(false);
        if (failed > 0) toast.warning(format(t.images.createdWithImageErrors, { count: failed }));
        else if (!result.warning) toast.success(t.products.created);
        if (result.warning) toast.warning(t.errors[result.warning]);
        router.push(`/${locale}/admin/products/${result.id}`);
      } else {
        setDirty(false);
        if (result.warning) toast.warning(t.errors[result.warning]);
        else toast.success(t.products.updated);
        // Back to the list (the toast lives in the admin layout, so it stays visible).
        router.push(`/${locale}/admin/products`);
      }
    });
  }

  // Active categories, plus the product's current one even if it was deactivated
  // (the relationship is never silently dropped).
  const choices = categories.filter(
    (category) => category.isActive || category.id === product?.category_id,
  );

  const saveLabel = progress
    ? format(t.images.uploadingProgress, { done: progress.done + 1, total: progress.total })
    : pending
      ? t.common.saving
      : product
        ? t.common.saveChanges
        : t.products.add;

  return (
    <div className="grid gap-4">
      {state.error && !pending && <Alert>{t.errors[state.error]}</Alert>}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_24rem]">
        <form
          id={formId}
          onSubmit={onSubmit}
          onChange={() => setDirty(true)}
          noValidate
          aria-busy={pending}
          className="grid min-w-0 gap-4"
        >
          <input type="hidden" name="id" value={product?.id ?? ""} readOnly />
          <input type="hidden" name="updatedAt" value={product?.updated_at ?? ""} readOnly />

          <Section title={t.products.sections.basic}>
            <Field id={`${id}-name`} label={f.name} error={errorText(fieldErrors.name)}>
              {(a11y) => (
                <Input
                  {...a11y}
                  name="name"
                  value={name}
                  maxLength={NAME_MAX_LENGTH}
                  required
                  disabled={pending}
                  onChange={(event) => {
                    setName(event.target.value);
                    if (!slugTouched) setSlug(slugify(event.target.value));
                  }}
                />
              )}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                id={`${id}-sku`}
                label={f.sku}
                hint={product ? f.skuHint : f.skuAutoHint}
                error={errorText(fieldErrors.sku)}
              >
                {(a11y) => (
                  <>
                    <Input
                      {...a11y}
                      name="sku"
                      dir="ltr"
                      maxLength={SKU_MAX_LENGTH}
                      required={Boolean(product)}
                      autoCapitalize="characters"
                      spellCheck={false}
                      disabled={pending}
                      defaultValue={product?.sku ?? suggestedSku ?? ""}
                      className="font-mono"
                    />
                    {!product && (
                      <input
                        type="hidden"
                        name="suggestedSku"
                        value={suggestedSku ?? ""}
                        readOnly
                      />
                    )}
                  </>
                )}
              </Field>
              <Field
                id={`${id}-slug`}
                label={f.slug}
                error={errorText(fieldErrors.slug)}
                hint={product && slug !== product.slug ? f.slugEditWarning : f.slugHint}
              >
                {(a11y) => (
                  <Input
                    {...a11y}
                    name="slug"
                    value={slug}
                    dir="ltr"
                    maxLength={200}
                    required
                    autoCapitalize="none"
                    spellCheck={false}
                    disabled={pending}
                    onChange={(event) => {
                      setSlug(event.target.value);
                      setSlugTouched(event.target.value !== "");
                    }}
                  />
                )}
              </Field>
            </div>
          </Section>

          <Section title={t.products.sections.organization}>
            <div className="grid gap-4 sm:grid-cols-2">
              <CategoryPicker
                idPrefix={id}
                categories={choices}
                currentId={product?.category_id ?? null}
                disabled={pending}
                error={errorText(fieldErrors.categoryId)}
                onChange={() => setDirty(true)}
                onSelect={setMainCategoryId}
              />
            </div>
            {tags && (
              <ProductTaxonomyFields
                idPrefix={id}
                categories={categories}
                tags={tags}
                saved={product?.taxonomy ?? { categoryIds: [], tagIds: [] }}
                mainCategoryId={mainCategoryId}
                disabled={pending}
                categoryError={errorText(fieldErrors.categoryIds)}
                tagError={errorText(fieldErrors.tagIds)}
                onChange={() => setDirty(true)}
              />
            )}
          </Section>

          {attributeCatalog && (
            <Section title={messages.attributes.product.section}>
              <ProductAttributes
                catalog={attributeCatalog}
                saved={product?.attributes ?? null}
                errors={attributeErrors}
                typeError={fieldErrors.productTypeId}
                disabled={pending}
                onChange={() => setDirty(true)}
              />
            </Section>
          )}

          <Section title={priceCurrencies ? t.products.prices.title : t.products.sections.pricing}>
            {priceCurrencies ? (
              <PriceTable
                currencies={priceCurrencies}
                base={currency}
                initial={prices}
                serverErrors={state.priceErrors}
                baseErrors={{
                  price: errorText(fieldErrors.compareAtPrice),
                  salePrice: errorText(fieldErrors.price),
                }}
                validate={pricesChecked}
                disabled={pending}
                onChange={() => setDirty(true)}
              />
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-[1fr_1fr_8rem]">
                  <Field id={`${id}-price`} label={f.price} error={errorText(fieldErrors.price)}>
                    {(a11y) => (
                      <Input
                        {...a11y}
                        name="price"
                        inputMode="decimal"
                        dir="ltr"
                        required
                        autoComplete="off"
                        disabled={pending}
                        placeholder="0.00"
                        defaultValue={
                          product ? moneyInputValue(product.price, product.currency_code) : ""
                        }
                      />
                    )}
                  </Field>
                  <Field
                    id={`${id}-compare`}
                    label={f.compareAtPrice}
                    optional={t.common.optional}
                    error={errorText(fieldErrors.compareAtPrice)}
                  >
                    {(a11y) => (
                      <Input
                        {...a11y}
                        name="compareAtPrice"
                        inputMode="decimal"
                        dir="ltr"
                        autoComplete="off"
                        disabled={pending}
                        defaultValue={
                          product
                            ? moneyInputValue(product.compare_at_price, product.currency_code)
                            : ""
                        }
                      />
                    )}
                  </Field>
                  <Field
                    id={`${id}-currency`}
                    label={f.currency}
                    error={errorText(fieldErrors.currencyCode)}
                  >
                    {(a11y) => (
                      <Combobox
                        {...a11y}
                        name="currencyCode"
                        dataField="currencyCode"
                        value={currency}
                        disabled={pending}
                        onChange={(code) => {
                          setCurrency(code);
                          setDirty(true);
                        }}
                        options={currencies.map((code) => ({ value: code, label: code }))}
                      />
                    )}
                  </Field>
                </div>
                <p className="-mt-2 text-xs text-muted-foreground">{f.compareAtHint}</p>
              </>
            )}
          </Section>

          <Section title={t.products.sections.inventory}>
            {product && product.variantCount > 0 ? (
              <>
                {/* Unchanged values keep validation happy; the server skips stock. */}
                <input type="hidden" name="expectedStock" value={loadedStock} readOnly />
                <input type="hidden" name="stock" value={loadedStock} readOnly />
                <input type="hidden" name="lowStockThreshold" value={threshold} readOnly />
                <div className="flex flex-wrap items-center gap-3 rounded-xl bg-muted/50 px-3.5 py-3 text-sm">
                  <p className="min-w-0 flex-1 text-muted-foreground">
                    {format(f.stockByVariants, { count: product.variantCount })}
                  </p>
                  <Link
                    href={`/${locale}/admin/products/${product.id}/variants`}
                    className={buttonClassName({ variant: "outline", size: "sm" })}
                  >
                    {t.products.variants}
                  </Link>
                </div>
              </>
            ) : (
              <>
                <input type="hidden" name="expectedStock" value={loadedStock} readOnly />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    id={`${id}-stock`}
                    label={f.stock}
                    hint={
                      product
                        ? reserved > 0
                          ? format(f.stockHintReserved, { reserved })
                          : f.stockHintEdit
                        : f.stockHintNew
                    }
                    error={errorText(fieldErrors.stock)}
                  >
                    {(a11y) => (
                      <Input
                        {...a11y}
                        name="stock"
                        inputMode="numeric"
                        dir="ltr"
                        required
                        autoComplete="off"
                        disabled={pending}
                        value={stock}
                        onChange={(event) => setStock(event.target.value)}
                      />
                    )}
                  </Field>
                  <Field
                    id={`${id}-threshold`}
                    label={f.lowStockThreshold}
                    hint={f.lowStockThresholdHint}
                    error={errorText(fieldErrors.lowStockThreshold)}
                  >
                    {(a11y) => (
                      <Input
                        {...a11y}
                        name="lowStockThreshold"
                        inputMode="numeric"
                        dir="ltr"
                        required
                        autoComplete="off"
                        disabled={pending}
                        value={threshold}
                        onChange={(event) => setThreshold(event.target.value)}
                      />
                    )}
                  </Field>
                </div>
                <StockPreview
                  stock={stock}
                  threshold={threshold}
                  reserved={reserved}
                  loadedStock={product ? loadedStock : null}
                  historyHref={product ? `/${locale}/admin/inventory/${product.id}` : null}
                />
              </>
            )}
          </Section>

          <Section title={t.products.sections.description}>
            <Field
              id={`${id}-short`}
              label={f.shortDescription}
              optional={t.common.optional}
              hint={f.shortDescriptionHint}
              error={errorText(fieldErrors.shortDescription)}
            >
              {(a11y) => (
                <Textarea
                  {...a11y}
                  name="shortDescription"
                  rows={2}
                  maxLength={SHORT_DESCRIPTION_MAX_LENGTH}
                  disabled={pending}
                  defaultValue={product?.short_description ?? ""}
                />
              )}
            </Field>
            <Field
              id={`${id}-description`}
              label={f.description}
              optional={t.common.optional}
              error={errorText(fieldErrors.description)}
            >
              {(a11y) => (
                <Textarea
                  {...a11y}
                  name="description"
                  rows={6}
                  maxLength={PRODUCT_DESCRIPTION_MAX_LENGTH}
                  disabled={pending}
                  defaultValue={product?.description ?? ""}
                />
              )}
            </Field>
          </Section>
        </form>

        {/* Side column: sticky on large screens so photos stay in view. */}
        <div className="grid gap-4 lg:sticky lg:top-20">
          {product ? (
            aside
          ) : (
            <>
              <Panel title={t.products.sections.status}>
                <label className="flex items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    name="isActive"
                    form={formId}
                    disabled={pending}
                    defaultChecked
                    onChange={() => setDirty(true)}
                    className="mt-0.5 size-4 accent-primary"
                  />
                  <span>
                    <span className="block font-medium">{f.active}</span>
                    <span className="block text-xs text-muted-foreground">{f.activeHint}</span>
                  </span>
                </label>
              </Panel>
              <Panel title={t.products.sections.images}>
                <div className="grid gap-3">
                  <ImageGallery
                    local
                    busy={pending}
                    productName={name}
                    items={images}
                    onSetPrimary={(key) =>
                      setImages((current) =>
                        current.map((image) => ({ ...image, isPrimary: image.key === key })),
                      )
                    }
                    onMove={moveImage}
                    onRemove={removeImage}
                    onAltChange={(key, alt) =>
                      setImages((current) =>
                        current.map((image) => (image.key === key ? { ...image, alt } : image)),
                      )
                    }
                  />
                  <ImageDropzone
                    multiple
                    disabled={pending}
                    prompt={t.images.dropzone}
                    browseLabel={t.images.browse}
                    activeLabel={t.images.dropActive}
                    hint={images.length === 0 ? t.images.hint : t.images.pendingHint}
                    onFiles={addImages}
                  />
                </div>
              </Panel>
            </>
          )}
        </div>
      </div>

      <div className="sticky bottom-0 z-10 -mx-4 flex items-center gap-2 border-t bg-background/90 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-md sm:mx-0 sm:rounded-2xl sm:border">
        <span className="me-auto truncate text-xs text-muted-foreground">
          {dirty && !pending ? t.common.unsaved : ""}
        </span>
        <Link
          href={`/${locale}/admin/products`}
          className={buttonClassName({ variant: "outline" })}
        >
          {t.common.cancel}
        </Link>
        <Button type="submit" form={formId} disabled={pending} aria-busy={pending}>
          {pending ? <LoaderCircle aria-hidden className="animate-spin" /> : <Save aria-hidden />}
          {saveLabel}
        </Button>
      </div>
    </div>
  );
}

/**
 * Reserved / available / resulting stock status for the typed values, so the
 * admin sees the effect before saving. Nothing shows while the input is invalid.
 */
function StockPreview({
  stock,
  threshold,
  reserved,
  loadedStock,
  historyHref,
}: {
  stock: string;
  threshold: string;
  reserved: number;
  /** Stock when the form loaded (edit only). */
  loadedStock: number | null;
  historyHref: string | null;
}) {
  const { locale, messages } = useI18n();
  const f = messages.catalogue.products.fields;
  const inventory = messages.inventory;
  const quantity = parseWholeNumber(stock);
  const alert = parseWholeNumber(threshold);
  if (quantity === null || alert === null) return null;

  const number = (value: number) => value.toLocaleString(locale);
  const status = stockStatus(quantity, reserved, alert);
  const change = loadedStock === null ? 0 : quantity - loadedStock;
  const stat = (label: string, value: ReactNode) => (
    <div className="min-w-0">
      <dt className="text-[0.6875rem] text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );

  return (
    <div className="-mt-1 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl bg-muted/50 px-3.5 py-3 text-sm">
      <dl className="flex flex-wrap gap-x-6 gap-y-2">
        {loadedStock !== null &&
          stat(
            f.stockCurrent,
            <bdi dir="ltr">
              {number(loadedStock)}
              {change !== 0 && (
                <span className={change > 0 ? "text-success" : "text-error"}>
                  {" → "}
                  {number(quantity)} ({change > 0 ? "+" : "−"}
                  {number(Math.abs(change))})
                </span>
              )}
            </bdi>,
          )}
        {reserved > 0 && stat(inventory.columns.reserved, number(reserved))}
        {stat(inventory.columns.available, number(Math.max(0, quantity - reserved)))}
      </dl>
      <StockStatusBadge status={status} label={inventory.status[status]} />
      {historyHref && (
        <Link
          href={historyHref}
          className="ms-auto inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          <History aria-hidden className="size-3.5" />
          {inventory.history.title}
        </Link>
      )}
    </div>
  );
}
