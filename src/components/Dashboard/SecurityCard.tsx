import type { FC } from 'react';
import styles from './SecurityCard.module.css';

interface SecurityCardProps {
    status: 'secure' | 'attack' | 'warning';
}

export const SecurityCard: FC<SecurityCardProps> = ({ status }) => {
    const isDanger = status === 'attack';
    const isWarning = status === 'warning';

    const statusClass = isDanger ? styles.danger : isWarning ? styles.warning : styles.safe;
    const statusLabel = isDanger ? 'UNDER ATTACK' : isWarning ? 'SYSTEM WARNING' : 'SYSTEM SECURE';

    return (
        <div className={`${styles.card} ${statusClass}`}>
            <div className={styles.gridBg} />

            <div className={styles.content}>
                <div className={styles.label}>DEFENSE STATUS</div>
                <div className={styles.statusText}>
                    {statusLabel}
                </div>
            </div>

            <div className={styles.statusIcon}>
                {/* Pulse Rings */}
                <div className={styles.pulseRing} />
                <div className={styles.pulseRing} />

                {/* Icon SVG */}
                <ShieldIcon status={status} />
            </div>
        </div>
    );
};

const ShieldIcon: FC<{ status: string }> = ({ status }) => {
    const color = status === 'attack' ? 'var(--status-danger)' : status === 'warning' ? 'var(--status-warning)' : 'var(--status-safe)';

    return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ zIndex: 5, filter: `drop-shadow(0 0 8px ${color})` }}>
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
            {status === 'secure' && <path d="M9 12l2 2 4-4"></path>}
            {status === 'attack' && <path d="M12 8v4m0 4h.01"></path>}
        </svg>
    );
};
