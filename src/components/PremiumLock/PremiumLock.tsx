import React, { useState } from 'react';
import styles from './PremiumLock.module.css';

interface PremiumLockProps {
  /** Whether the feature is locked (not premium) */
  isLocked: boolean;
  /** The content to render (will be disabled if locked) */
  children: React.ReactNode;
  /** Optional custom message */
  message?: string;
  /** Callback when user clicks on upgrade */
  onUpgradeClick?: () => void;
}

/**
 * Wraps a feature with a premium lock overlay.
 * Shows a lock icon and disables the feature if the group is not premium.
 */
export function PremiumLock({
  isLocked,
  children,
  message = 'Upgrade to Premium to unlock this feature',
  onUpgradeClick,
}: PremiumLockProps) {
  const [showPopup, setShowPopup] = useState(false);

  if (!isLocked) {
    return <>{children}</>;
  }

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setShowPopup(true);
  };

  const handleUpgrade = () => {
    setShowPopup(false);
    onUpgradeClick?.();
  };

  return (
    <div className={styles.wrapper}>
      <div className={styles.lockedContent} onClick={handleClick}>
        {children}
        <div className={styles.lockOverlay}>
          <span className={styles.lockIcon}>🔒</span>
        </div>
      </div>

      {showPopup && (
        <div className={styles.popupOverlay} onClick={() => setShowPopup(false)}>
          <div className={styles.popup} onClick={(e) => e.stopPropagation()}>
            <div className={styles.popupIcon}>⭐</div>
            <h3 className={styles.popupTitle}>Premium Feature</h3>
            <p className={styles.popupMessage}>{message}</p>
            <div className={styles.popupActions}>
              <button
                className={styles.upgradeButton}
                onClick={handleUpgrade}
              >
                🛒 Upgrade to Premium
              </button>
              <button
                className={styles.closeButton}
                onClick={() => setShowPopup(false)}
              >
                Maybe Later
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Small badge to indicate a premium feature
 */
export function PremiumBadge({ className }: { className?: string }) {
  return (
    <span className={`${styles.premiumBadge} ${className || ''}`}>
      🔒 Premium
    </span>
  );
}

/**
 * Inline lock icon for settings labels
 */
export function PremiumLockIcon({ tooltip }: { tooltip?: string }) {
  return (
    <span className={styles.inlineLockIcon} title={tooltip || 'Premium feature'}>
      🔒
    </span>
  );
}

export default PremiumLock;
