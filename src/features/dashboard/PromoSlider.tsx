import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { openLink } from '@telegram-apps/sdk-react';
import { Button, Text } from '@telegram-apps/telegram-ui';

import { trackPromoSlideEvent } from './api.ts';
import type { DashboardPromoMetadata, DashboardPromoSlot } from './types.ts';

import styles from './PromoSlider.module.css';

type Props = {
  slots: DashboardPromoSlot[];
  rotationSeconds?: number;
  metadata?: DashboardPromoMetadata;
  canManage?: boolean;
  onManageClick?: () => void;
};

const MIN_ROTATION_SECONDS = 4;
const BOUNCE_THRESHOLD_MS = 1500;

export function PromoSlider({ slots, rotationSeconds = 6, metadata, canManage = false, onManageClick }: Props) {
  const intervalRef = useRef<number | null>(null);
  const lastViewRef = useRef<{ id: string; startedAt: number; variant: string | null } | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const activeSlots = useMemo(
    () =>
      slots
        .filter((slot) => slot.active)
        .slice(0, metadata?.maxSlots ?? 5),
    [slots, metadata?.maxSlots],
  );

  const effectiveRotationSec = Math.max(rotationSeconds, MIN_ROTATION_SECONDS);
  const showManageButton = Boolean(canManage && typeof onManageClick === 'function');

  const clearAutoplay = useCallback(() => {
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const scheduleAutoplay = useCallback(() => {
    clearAutoplay();
    if (activeSlots.length <= 1) {
      return;
    }
    intervalRef.current = window.setInterval(() => {
      setActiveIndex((previous) => {
        const nextIndex = previous + 1;
        if (nextIndex >= activeSlots.length) {
          return 0;
        }
        return nextIndex;
      });
    }, effectiveRotationSec * 1000);
  }, [activeSlots.length, clearAutoplay, effectiveRotationSec]);

  useEffect(() => {
    if (activeSlots.length === 0) {
      setActiveIndex(0);
      clearAutoplay();
      lastViewRef.current = null;
      return;
    }
    setActiveIndex((current) => Math.min(current, activeSlots.length - 1));
    scheduleAutoplay();
    return () => {
      clearAutoplay();
    };
  }, [activeSlots.length, scheduleAutoplay, clearAutoplay]);

  useEffect(() => {
    if (activeSlots.length === 0) {
      return;
    }
    const now = Date.now();
    const currentSlide = activeSlots[Math.min(activeIndex, activeSlots.length - 1)];
    if (!currentSlide) {
      return;
    }

    const previous = lastViewRef.current;
    if (previous && previous.id !== currentSlide.id) {
      const duration = Math.max(0, now - previous.startedAt);
      void trackPromoSlideEvent(previous.id, 'view', {
        durationMs: duration,
        bounced: duration < BOUNCE_THRESHOLD_MS,
        variant: previous.variant,
      });
    }

    if (!previous || previous.id !== currentSlide.id) {
      lastViewRef.current = {
        id: currentSlide.id,
        startedAt: now,
        variant: currentSlide.variant ?? null,
      };
    }
  }, [activeIndex, activeSlots]);

  useEffect(() => {
    return () => {
      const previous = lastViewRef.current;
      if (previous) {
        const duration = Math.max(0, Date.now() - previous.startedAt);
        void trackPromoSlideEvent(previous.id, 'view', {
          durationMs: duration,
          bounced: duration < BOUNCE_THRESHOLD_MS,
          variant: previous.variant,
        });
      }
    };
  }, [activeSlots]);

  const handleDotClick = useCallback(
    (index: number) => {
      if (index === activeIndex) {
        return;
      }
      setActiveIndex(index);
      scheduleAutoplay();
    },
    [activeIndex, scheduleAutoplay],
  );

  const handleOpenLink = useCallback((slot: DashboardPromoSlot) => {
    const target = slot.ctaLink ?? slot.linkUrl;
    if (!target) {
      return;
    }
    void trackPromoSlideEvent(slot.id, 'click', { variant: slot.variant ?? null });
    openLink(target);
  }, []);

  if (activeSlots.length === 0) {
    return null;
  }

  return (
    <section className={styles.slider}>
      {showManageButton && (
        <div className={styles.toolbar}>
          <Button mode='plain' size='s' onClick={onManageClick}>
            Manage slider
          </Button>
        </div>
      )}
      <div className={styles.viewport}>
        <div
          className={styles.track}
          style={{ transform: `translateX(-${activeIndex * 100}%)` }}
        >
          {activeSlots.map((slot) => {
          const accent = slot.accentColor ?? '#0f172a';
          const imageSrc = slot.imageUrl ?? slot.thumbnailUrl ?? '';

          return (
            <article key={slot.id} className={styles.slide} data-variant={slot.variant ?? undefined}>
              <div
                className={styles.slideInner}
                style={{
                  backgroundImage: `linear-gradient(135deg, ${accent}, rgba(4, 7, 15, 0.94))`,
                }}
              >
                <div className={styles.slideContent}>
                  {slot.title && (
                    <Text weight='3' className={styles.slideTitle}>
                      {slot.title}
                    </Text>
                  )}
                  {slot.subtitle && (
                    <Text weight='2' className={styles.slideSubtitle}>
                      {slot.subtitle}
                    </Text>
                  )}
                  {slot.description && (
                    <Text weight='2' className={styles.slideDescription}>
                      {slot.description}
                    </Text>
                  )}
                  {slot.ctaLabel && (slot.ctaLink || slot.linkUrl) && (
                    <Button mode='filled' size='l' onClick={() => handleOpenLink(slot)}>
                      {slot.ctaLabel}
                    </Button>
                  )}
                </div>
                {imageSrc && (
                  <img
                    className={styles.slideImage}
                    src={imageSrc}
                    alt=''
                    role='presentation'
                    loading={slot.id === activeSlots[activeIndex]?.id ? 'eager' : 'lazy'}
                    decoding='async'
                    draggable={false}
                  />
                )}
              </div>
            </article>
          );
          })}
        </div>
      </div>
      {activeSlots.length > 1 && (
        <div className={styles.dots}>
          {activeSlots.map((slot, index) => (
            <button
              key={slot.id}
              type='button'
              className={index === activeIndex ? styles.dotActive : styles.dot}
              aria-label={`Show slide ${index + 1}`}
              onClick={() => handleDotClick(index)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
