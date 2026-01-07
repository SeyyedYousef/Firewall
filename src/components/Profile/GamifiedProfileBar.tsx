import type { FC } from 'react';
import styles from './GamifiedProfileBar.module.css';

interface GamifiedProfileBarProps {
    level: number;
    currentXP: number;
    maxXP: number;
    badges: string[]; // SVGs or image URLs or unicode
}

export const GamifiedProfileBar: FC<GamifiedProfileBarProps> = ({
    level,
    currentXP,
    maxXP,
    badges,
}) => {
    const progress = Math.min((currentXP / maxXP) * 100, 100);

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <div className={styles.levelInfo}>
                    <div className={styles.levelLabel}>Rank Level</div>
                    <div className={styles.levelValue}>{level}</div>
                </div>
                <div className={styles.xpText}>
                    {currentXP} / {maxXP} XP
                </div>
            </div>

            <div className={styles.progressContainer}>
                <div
                    className={styles.progressBar}
                    style={{ width: `${progress}%` }}
                />
            </div>

            <div className={styles.badges}>
                {badges.map((badge, index) => (
                    <div key={index} className={styles.badgeSlot}>
                        <div className={styles.badge}>{badge}</div>
                    </div>
                ))}
                {/* Empty slots placeholders */}
                {Array.from({ length: Math.max(0, 3 - badges.length) }).map((_, i) => (
                    <div key={`empty-${i}`} className={styles.badgeSlot} />
                ))}
            </div>
        </div>
    );
};
