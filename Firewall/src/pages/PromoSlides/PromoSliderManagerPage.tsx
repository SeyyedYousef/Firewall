import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@telegram-apps/telegram-ui';

import {
  createPromoSlideEntry,
  deletePromoSlideEntry,
  fetchAllPromoSlides,
  fetchDashboardSnapshot,
  reorderPromoSlideEntries,
  updatePromoSlideEntry,
} from '@/features/dashboard/api.ts';
import type { DashboardPromoMetadata, DashboardPromoSlot } from '@/features/dashboard/types.ts';

import styles from './PromoSliderManagerPage.module.css';

const DEFAULT_WIDTH = 960;
const DEFAULT_HEIGHT = 360;

type DraftSlide = {
  title: string;
  subtitle: string;
  description: string;
  linkUrl: string;
  ctaLabel: string;
  ctaLink: string;
  accentColor: string;
  active: boolean;
  startsAt: string;
  endsAt: string;
  abTestGroupId: string;
  variant: string;
};

type UploadDraft = {
  fileName: string;
  imageData: string;
  previewUrl: string;
  title: string;
  subtitle: string;
  description: string;
  linkUrl: string;
  ctaLabel: string;
  ctaLink: string;
  accentColor: string;
  abTestGroupId: string;
  variant: string;
};

function toInputDateTime(iso: string | null | undefined): string {
  if (!iso) {
    return '';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const isoString = date.toISOString();
  return isoString.slice(0, 16);
}

function fromInputDateTime(value: string): string | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

function buildDraftFromSlide(slide: DashboardPromoSlot): DraftSlide {
  return {
    title: slide.title ?? '',
    subtitle: slide.subtitle ?? '',
    description: slide.description ?? '',
    linkUrl: slide.linkUrl ?? slide.ctaLink ?? '',
    ctaLabel: slide.ctaLabel ?? '',
    ctaLink: slide.ctaLink ?? '',
    accentColor: slide.accentColor ?? '#0f172a',
    active: slide.active,
    startsAt: toInputDateTime(slide.startsAt),
    endsAt: toInputDateTime(slide.endsAt),
    abTestGroupId: slide.abTestGroupId ?? '',
    variant: slide.variant ?? '',
  };
}

function moveSlide(list: DashboardPromoSlot[], sourceId: string, targetId: string | null): DashboardPromoSlot[] {
  if (sourceId === targetId) {
    return list;
  }
  const next = [...list];
  const sourceIndex = next.findIndex((item) => item.id === sourceId);
  if (sourceIndex === -1) {
    return next;
  }
  const [item] = next.splice(sourceIndex, 1);
  if (targetId === null) {
    next.push(item);
    return next;
  }
  const targetIndex = next.findIndex((entry) => entry.id === targetId);
  if (targetIndex === -1) {
    next.push(item);
  } else {
    next.splice(targetIndex, 0, item);
  }
  return next;
}

async function resizeImageToWebp(file: File, width: number, height: number): Promise<{ dataUrl: string; preview: string }> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Failed to read file'));
        return;
      }
      resolve(reader.result);
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error('Failed to read file'));
    };
    reader.readAsDataURL(file);
  });

  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Unable to decode image'));
    img.src = dataUrl;
  });

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas context not available');
  }

  const scale = Math.min(image.width / width, image.height / height);
  const cropWidth = width * scale;
  const cropHeight = height * scale;
  const sx = (image.width - cropWidth) / 2;
  const sy = (image.height - cropHeight) / 2;

  ctx.drawImage(image, sx, sy, cropWidth, cropHeight, 0, 0, width, height);
  const result = canvas.toDataURL('image/webp', 0.92);
  return { dataUrl: result, preview: result };
}

export function PromoSliderManagerPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<DashboardPromoMetadata | null>(null);
  const [slides, setSlides] = useState<DashboardPromoSlot[]>([]);
  const [drafts, setDrafts] = useState<Record<string, DraftSlide>>({});
  const [uploadDraft, setUploadDraft] = useState<UploadDraft>({
    fileName: '',
    imageData: '',
    previewUrl: '',
    title: '',
    subtitle: '',
    description: '',
    linkUrl: '',
    ctaLabel: '',
    ctaLink: '',
    accentColor: '#2563eb',
    abTestGroupId: '',
    variant: '',
  });
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [savingSlideId, setSavingSlideId] = useState<string | null>(null);
  const [removingSlideId, setRemovingSlideId] = useState<string | null>(null);
  const dragSourceRef = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const recommendedDimensions = useMemo(() => {
    const width = metadata?.recommendedWidth ?? DEFAULT_WIDTH;
    const height = metadata?.recommendedHeight ?? DEFAULT_HEIGHT;
    return { width, height };
  }, [metadata]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [snapshot, promoResponse] = await Promise.all([fetchDashboardSnapshot(), fetchAllPromoSlides()]);
      const currentMetadata = snapshot.promotions?.metadata ?? null;
      setMetadata(currentMetadata);
      const fetchedSlides = promoResponse.slides ?? [];
      setSlides(fetchedSlides);
      const initialDrafts: Record<string, DraftSlide> = {};
      fetchedSlides.forEach((slide) => {
        initialDrafts[slide.id] = buildDraftFromSlide(slide);
      });
      setDrafts(initialDrafts);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleFileSelection = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) {
        return;
      }
      const file = files[0];
      try {
        const { width, height } = recommendedDimensions;
        const { dataUrl, preview } = await resizeImageToWebp(file, width, height);
        setUploadDraft((prev) => ({
          ...prev,
          fileName: file.name,
          imageData: dataUrl,
          previewUrl: preview,
        }));
        setUploadError(null);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setUploadError(message);
      }
    },
    [recommendedDimensions],
  );

  const handleDropZoneClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleCreateSlide = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!uploadDraft.imageData || !uploadDraft.linkUrl) {
        setUploadError("Image and destination link are required.");
        return;
      }
      setUploading(true);
      setUploadError(null);
      try {
        const payload = {
          imageData: uploadDraft.imageData,
          fileName: uploadDraft.fileName || `promo-${Date.now()}.webp`,
          linkUrl: uploadDraft.linkUrl.trim(),
          title: uploadDraft.title.trim(),
          subtitle: uploadDraft.subtitle.trim(),
          description: uploadDraft.description.trim(),
          ctaLabel: uploadDraft.ctaLabel.trim(),
          ctaLink: uploadDraft.ctaLink.trim(),
          accentColor: uploadDraft.accentColor,
          abTestGroupId: uploadDraft.abTestGroupId.trim(),
          variant: uploadDraft.variant.trim(),
          metadata: {
            source: 'mini-app',
          },
        };

        const created = await createPromoSlideEntry(payload);
        setSlides((prev) => [created, ...prev]);
        setDrafts((prev) => ({
          ...prev,
          [created.id]: buildDraftFromSlide(created),
        }));
        setUploadDraft({
          fileName: '',
          imageData: '',
          previewUrl: '',
          title: '',
          subtitle: '',
          description: '',
          linkUrl: '',
          ctaLabel: '',
          ctaLink: '',
          accentColor: '#2563eb',
          abTestGroupId: '',
          variant: '',
        });
        setFeedback('Promo slide created successfully.');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setUploadError(message);
      } finally {
        setUploading(false);
      }
    },
    [uploadDraft],
  );

  const handleDraftChange = useCallback(
    (slideId: string, updates: Partial<DraftSlide>) => {
      setDrafts((prev) => ({
        ...prev,
        [slideId]: {
          ...(prev[slideId] ?? buildDraftFromSlide(slides.find((slide) => slide.id === slideId)!)),
          ...updates,
        },
      }));
    },
    [slides],
  );

  const handleSaveSlide = useCallback(
    async (slide: DashboardPromoSlot) => {
      const draft = drafts[slide.id] ?? buildDraftFromSlide(slide);
      const patch: Record<string, unknown> = {};
      if ((draft.title || '') !== (slide.title ?? '')) {
        patch.title = draft.title || null;
      }
      if ((draft.subtitle || '') !== (slide.subtitle ?? '')) {
        patch.subtitle = draft.subtitle || null;
      }
      if ((draft.description || '') !== (slide.description ?? '')) {
        patch.description = draft.description || null;
      }
      const draftLink = draft.linkUrl.trim();
      const currentLink = (slide.linkUrl ?? slide.ctaLink ?? '').trim();
      if (draftLink !== currentLink) {
        patch.linkUrl = draftLink || null;
      }
      const draftCtaLabel = draft.ctaLabel.trim();
      if (draftCtaLabel !== (slide.ctaLabel ?? '').trim()) {
        patch.ctaLabel = draftCtaLabel || null;
      }
      const draftCtaLink = draft.ctaLink.trim();
      if (draftCtaLink !== (slide.ctaLink ?? '').trim()) {
        patch.ctaLink = draftCtaLink || null;
      }
      if ((draft.accentColor || '') !== (slide.accentColor ?? '')) {
        patch.accentColor = draft.accentColor || null;
      }
      if (draft.active !== slide.active) {
        patch.active = draft.active;
      }
      const draftStartsAtIso = fromInputDateTime(draft.startsAt);
      if (draftStartsAtIso !== (slide.startsAt ?? null)) {
        patch.startsAt = draftStartsAtIso;
      }
      const draftEndsAtIso = fromInputDateTime(draft.endsAt);
      if (draftEndsAtIso !== (slide.endsAt ?? null)) {
        patch.endsAt = draftEndsAtIso;
      }
      if ((draft.abTestGroupId || '') !== (slide.abTestGroupId ?? '')) {
        patch.abTestGroupId = draft.abTestGroupId || null;
      }
      if ((draft.variant || '') !== (slide.variant ?? '')) {
        patch.variant = draft.variant || null;
      }

      if (Object.keys(patch).length === 0) {
        setFeedback('No changes to save.');
        return;
      }

      setSavingSlideId(slide.id);
      try {
        const updated = await updatePromoSlideEntry(slide.id, patch);
        setSlides((prev) => prev.map((entry) => (entry.id === updated.id ? updated : entry)));
        setDrafts((prev) => ({
          ...prev,
          [updated.id]: buildDraftFromSlide(updated),
        }));
        setFeedback('Slide updated.');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
      } finally {
        setSavingSlideId(null);
      }
    },
    [drafts],
  );

  const handleDeleteSlide = useCallback(
    async (slideId: string) => {
      setRemovingSlideId(slideId);
      try {
        await deletePromoSlideEntry(slideId);
        setSlides((prev) => prev.filter((slide) => slide.id !== slideId));
        setDrafts((prev) => {
          const next = { ...prev };
          delete next[slideId];
          return next;
        });
        setFeedback('Slide removed.');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
      } finally {
        setRemovingSlideId(null);
      }
    },
    [],
  );

  const handleDrop = useCallback(
    (event: React.DragEvent, targetId: string | null) => {
      event.preventDefault();
      const sourceId = dragSourceRef.current;
      dragSourceRef.current = null;
      setDragOverId(null);
      if (!sourceId || sourceId === targetId) {
        return;
      }
      setSlides((prev) => {
        const next = moveSlide(prev, sourceId, targetId);
        const order = next.map((slide) => slide.id);
        void reorderPromoSlideEntries(order)
          .then((serverSlides) => {
            setSlides(serverSlides);
            setDrafts((prevDrafts) => {
              const merged: Record<string, DraftSlide> = {};
              serverSlides.forEach((slide) => {
                merged[slide.id] = prevDrafts[slide.id] ?? buildDraftFromSlide(slide);
              });
              return merged;
            });
            setFeedback('Slides reordered.');
          })
          .catch((err) => {
            const message = err instanceof Error ? err.message : String(err);
            setError(message);
            void loadData();
          });
        return next;
      });
    },
    [loadData],
  );

  const handleDragStart = useCallback((event: React.DragEvent, slideId: string) => {
    dragSourceRef.current = slideId;
    event.dataTransfer.setData('text/plain', slideId);
    event.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDragEnter = useCallback((slideId: string | null) => {
    setDragOverId(slideId);
  }, []);

  const handleDropZone = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const files = event.dataTransfer.files;
      void handleFileSelection(files);
    },
    [handleFileSelection],
  );

  return (
    <div className={styles.page} dir='ltr'>
      <header className={styles.header}>
        <div className={styles.headerRow}>
          <Button mode='plain' onClick={() => navigate(-1)}>
            ← Back
          </Button>
          <h1 className={styles.title}>Promo Slider Management</h1>
        </div>
        <p className={styles.subtitle}>
          Upload, schedule, and analyse the promo banners displayed on the dashboard carousel.
        </p>
        <div className={styles.meta}>
          <span>
            Recommended size: {recommendedDimensions.width}×{recommendedDimensions.height}px
          </span>
          {metadata?.analyticsLookbackDays && (
            <span>Analytics window: last {metadata.analyticsLookbackDays} days</span>
          )}
        </div>
        {feedback && <div className={styles.feedback}>{feedback}</div>}
        {error && <div className={styles.error}>{error}</div>}
      </header>

      <section className={styles.uploadSection}>
        <h2 className={styles.sectionTitle}>Create new slide</h2>
        <p className={styles.sectionHint}>
          Drag and drop an image, or click the area below to select a file. Images are automatically cropped and
          compressed to WebP.
        </p>
        <div
          className={styles.dropzone}
          onClick={handleDropZoneClick}
          onDragOver={(event) => event.preventDefault()}
          onDragEnter={(event) => {
            event.preventDefault();
            handleDragEnter(null);
          }}
          onDrop={handleDropZone}
        >
          {uploadDraft.previewUrl ? (
            <img className={styles.previewImage} src={uploadDraft.previewUrl} alt='Slide preview' />
          ) : (
            <div className={styles.dropzonePlaceholder}>
              <span>Drop image here or click to browse</span>
            </div>
          )}
        </div>
        <input
          ref={fileInputRef}
          type='file'
          accept='image/*'
          className={styles.fileInput}
          onChange={(event) => void handleFileSelection(event.target.files)}
        />
        {uploadError && <div className={styles.error}>{uploadError}</div>}

        <form className={styles.uploadForm} onSubmit={handleCreateSlide}>
          <div className={styles.formGrid}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Destination link *</span>
              <input
                type='url'
                required
                value={uploadDraft.linkUrl}
                onChange={(event) => setUploadDraft((prev) => ({ ...prev, linkUrl: event.target.value }))}
                className={styles.input}
                placeholder='https://'
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Title</span>
              <input
                type='text'
                value={uploadDraft.title}
                onChange={(event) => setUploadDraft((prev) => ({ ...prev, title: event.target.value }))}
                className={styles.input}
                maxLength={80}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Subtitle</span>
              <input
                type='text'
                value={uploadDraft.subtitle}
                onChange={(event) => setUploadDraft((prev) => ({ ...prev, subtitle: event.target.value }))}
                className={styles.input}
                maxLength={120}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>CTA Label</span>
              <input
                type='text'
                value={uploadDraft.ctaLabel}
                onChange={(event) => setUploadDraft((prev) => ({ ...prev, ctaLabel: event.target.value }))}
                className={styles.input}
                maxLength={40}
                placeholder='Open dashboard'
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>CTA link override</span>
              <input
                type='url'
                value={uploadDraft.ctaLink}
                onChange={(event) => setUploadDraft((prev) => ({ ...prev, ctaLink: event.target.value }))}
                className={styles.input}
                placeholder='https://'
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Accent color</span>
              <input
                type='color'
                value={uploadDraft.accentColor}
                onChange={(event) => setUploadDraft((prev) => ({ ...prev, accentColor: event.target.value }))}
                className={styles.colorInput}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>A/B test group</span>
              <input
                type='text'
                value={uploadDraft.abTestGroupId}
                onChange={(event) => setUploadDraft((prev) => ({ ...prev, abTestGroupId: event.target.value }))}
                className={styles.input}
                placeholder='group-id'
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Variant</span>
              <input
                type='text'
                value={uploadDraft.variant}
                onChange={(event) => setUploadDraft((prev) => ({ ...prev, variant: event.target.value }))}
                className={styles.input}
                placeholder='A / B / control'
              />
            </label>
            <label className={styles.fieldWide}>
              <span className={styles.fieldLabel}>Description</span>
              <textarea
                value={uploadDraft.description}
                onChange={(event) => setUploadDraft((prev) => ({ ...prev, description: event.target.value }))}
                className={styles.textarea}
                maxLength={200}
                rows={3}
              />
            </label>
          </div>
          <div className={styles.actionsRow}>
            <Button mode='filled' size='l' disabled={uploading || !uploadDraft.imageData} type='submit'>
              {uploading ? 'Uploading…' : 'Create slide'}
            </Button>
          </div>
        </form>
      </section>

      <section className={styles.listSection}>
        <h2 className={styles.sectionTitle}>Existing slides</h2>
        {loading ? (
          <div className={styles.placeholder}>Loading promo slides…</div>
        ) : slides.length === 0 ? (
          <div className={styles.placeholder}>No promo slides have been configured yet.</div>
        ) : (
          <div className={styles.cardList}>
            {slides.map((slide) => {
              const draft = drafts[slide.id] ?? buildDraftFromSlide(slide);
              const isSaving = savingSlideId === slide.id;
              const isRemoving = removingSlideId === slide.id;
              return (
                <article
                  key={slide.id}
                  className={`${styles.card} ${dragOverId === slide.id ? styles.cardDragOver : ''}`}
                  draggable
                  onDragStart={(event) => handleDragStart(event, slide.id)}
                  onDragEnter={() => handleDragEnter(slide.id)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => handleDrop(event, slide.id)}
                  onDragEnd={() => {
                    dragSourceRef.current = null;
                    setDragOverId(null);
                  }}
                >
                  <header className={styles.cardHeader}>
                    <div className={styles.cardTitleGroup}>
                      <span className={styles.cardBadge}>{slide.id}</span>
                      <span className={styles.cardStatus}>{slide.active ? 'Active' : 'Inactive'}</span>
                    </div>
                    <div className={styles.cardActions}>
                      <Button
                        mode='bezeled'
                        size='s'
                        onClick={() => void handleSaveSlide(slide)}
                        disabled={isSaving || isRemoving}
                      >
                        {isSaving ? 'Saving…' : 'Save changes'}
                      </Button>
                      <Button
                        mode='plain'
                        size='s'
                        onClick={() => void handleDeleteSlide(slide.id)}
                        disabled={isSaving || isRemoving}
                      >
                        {isRemoving ? 'Removing…' : 'Remove'}
                      </Button>
                    </div>
                  </header>

                  <div className={styles.cardBody}>
                    <div className={styles.previewColumn}>
                      {slide.imageUrl && (
                        <img className={styles.cardPreview} src={slide.imageUrl} alt={slide.title ?? ''} />
                      )}
                      <div className={styles.analytics}>
                        <span>
                          <strong>{slide.analytics.impressions}</strong> impressions
                        </span>
                        <span>
                          <strong>{slide.analytics.clicks}</strong> clicks
                        </span>
                        <span>
                          CTR {(slide.analytics.ctr * 100).toFixed(2)}%
                        </span>
                        <span>
                          Avg time {slide.analytics.avgTimeSpent.toFixed(1)}s
                        </span>
                      </div>
                    </div>

                    <div className={styles.fieldsColumn}>
                      <div className={styles.fieldGrid}>
                        <label className={styles.field}>
                          <span className={styles.fieldLabel}>Title</span>
                          <input
                            type='text'
                            value={draft.title}
                            onChange={(event) => handleDraftChange(slide.id, { title: event.target.value })}
                            className={styles.input}
                            maxLength={80}
                          />
                        </label>
                        <label className={styles.field}>
                          <span className={styles.fieldLabel}>Subtitle</span>
                          <input
                            type='text'
                            value={draft.subtitle}
                            onChange={(event) => handleDraftChange(slide.id, { subtitle: event.target.value })}
                            className={styles.input}
                            maxLength={120}
                          />
                        </label>
                        <label className={styles.fieldWide}>
                          <span className={styles.fieldLabel}>Description</span>
                          <textarea
                            value={draft.description}
                            onChange={(event) => handleDraftChange(slide.id, { description: event.target.value })}
                            className={styles.textarea}
                            rows={3}
                            maxLength={220}
                          />
                        </label>
                        <label className={styles.field}>
                          <span className={styles.fieldLabel}>Link</span>
                          <input
                            type='url'
                            value={draft.linkUrl}
                            onChange={(event) => handleDraftChange(slide.id, { linkUrl: event.target.value })}
                            className={styles.input}
                          />
                        </label>
                        <label className={styles.field}>
                          <span className={styles.fieldLabel}>CTA Label</span>
                          <input
                            type='text'
                            value={draft.ctaLabel}
                            onChange={(event) => handleDraftChange(slide.id, { ctaLabel: event.target.value })}
                            className={styles.input}
                            maxLength={40}
                          />
                        </label>
                        <label className={styles.field}>
                          <span className={styles.fieldLabel}>CTA link override</span>
                          <input
                            type='url'
                            value={draft.ctaLink}
                            onChange={(event) => handleDraftChange(slide.id, { ctaLink: event.target.value })}
                            className={styles.input}
                          />
                        </label>
                        <label className={styles.field}>
                          <span className={styles.fieldLabel}>Accent color</span>
                          <input
                            type='color'
                            value={draft.accentColor}
                            onChange={(event) => handleDraftChange(slide.id, { accentColor: event.target.value })}
                            className={styles.colorInput}
                          />
                        </label>
                        <label className={styles.field}>
                          <span className={styles.fieldLabel}>Active</span>
                          <input
                            type='checkbox'
                            checked={draft.active}
                            onChange={(event) => handleDraftChange(slide.id, { active: event.target.checked })}
                          />
                        </label>
                        <label className={styles.field}>
                          <span className={styles.fieldLabel}>Start time</span>
                          <input
                            type='datetime-local'
                            value={draft.startsAt}
                            onChange={(event) => handleDraftChange(slide.id, { startsAt: event.target.value })}
                            className={styles.input}
                          />
                        </label>
                        <label className={styles.field}>
                          <span className={styles.fieldLabel}>End time</span>
                          <input
                            type='datetime-local'
                            value={draft.endsAt}
                            onChange={(event) => handleDraftChange(slide.id, { endsAt: event.target.value })}
                            className={styles.input}
                          />
                        </label>
                        <label className={styles.field}>
                          <span className={styles.fieldLabel}>A/B group</span>
                          <input
                            type='text'
                            value={draft.abTestGroupId}
                            onChange={(event) => handleDraftChange(slide.id, { abTestGroupId: event.target.value })}
                            className={styles.input}
                          />
                        </label>
                        <label className={styles.field}>
                          <span className={styles.fieldLabel}>Variant</span>
                          <input
                            type='text'
                            value={draft.variant}
                            onChange={(event) => handleDraftChange(slide.id, { variant: event.target.value })}
                            className={styles.input}
                          />
                        </label>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}

            <div
              className={`${styles.dropTail} ${dragOverId === 'tail' ? styles.cardDragOver : ''}`}
              onDragEnter={() => handleDragEnter('tail')}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => handleDrop(event, null)}
            >
              Drop here to move slide to the end
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
