import { useNavigate } from 'react-router-dom';
import { useDashboardData } from '@/features/dashboard/useDashboardData';
import { Skeleton } from '@/components/UI/Skeleton';
import { hapticFeedback } from '@telegram-apps/sdk-react';
import styles from './ConfigPage.module.css';

export function ConfigPage() {
    const navigate = useNavigate();
    const { groups, loading } = useDashboardData();

    if (loading) {
        return (
            <div className={styles.page}>
                <div className={styles.header}>
                    <Skeleton width="180px" height="32px" />
                    <Skeleton width="140px" height="16px" style={{ marginTop: 12 }} />
                </div>
                <div className={styles.serverList}>
                    {[1, 2, 3].map(i => (
                        <Skeleton key={i} height="70px" style={{ borderRadius: 4 }} />
                    ))}
                </div>
            </div>
        );
    }

    const handleAccess = (id: string) => {
        hapticFeedback.impactOccurred('light');
        navigate(`/groups/${id}`);
    };

    return (
        <div className={styles.page}>
            <header className={styles.header}>
                <h1 className={styles.title}>
                    YOUR GROUPS
                </h1>
                <p className={styles.subtitle}>SECURE GROUP MANAGEMENT</p>
            </header>

            <div className={styles.serverList}>
                {groups.length === 0 ? (
                    <div className={styles.emptyState}>
                        <div className={styles.emptyIcon}>🚫</div>
                        <div style={{ color: '#888', fontSize: '14px' }}>NO GROUPS FOUND</div>
                    </div>
                ) : (
                    groups.map(group => {
                        const isActive = group.status.kind === 'active';
                        const isExpired = group.status.kind === 'expired';

                        let statusClass = styles.free;
                        if (isActive) statusClass = styles.active;
                        if (isExpired) statusClass = styles.expired;

                        // Mock ID for "tech" look (last 6 chars of ID)
                        const shortId = group.id.toString().slice(-6).toUpperCase();

                        return (
                            <div
                                key={group.id}
                                className={`${styles.serverModule} ${statusClass}`}
                                onClick={() => handleAccess(group.id)}
                            >
                                <div className={styles.moduleInfo}>
                                    <div className={styles.moduleId}>GRP::{shortId}</div>
                                    <div className={styles.moduleName}>{group.title}</div>
                                    <div className={styles.moduleStatus}>
                                        <span className={`${styles.led} ${isActive ? styles.on : styles.off}`} />
                                        <span style={{ color: isActive ? '#10b981' : isExpired ? '#ef4444' : '#9ca3af' }}>
                                            {isActive ? 'PREMIUM' : isExpired ? 'EXPIRED' : 'FREE'}
                                        </span>
                                        {group.status.kind === 'active' && group.status.daysLeft && (
                                            <span style={{ opacity: 0.5, marginLeft: 4 }}>
                                                [{group.status.daysLeft}D REMAINING]
                                            </span>
                                        )}
                                    </div>
                                </div>

                                <button
                                    className={styles.actionButton}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleAccess(group.id);
                                    }}
                                >
                                    CONFIG <span className={styles.arrow}>→</span>
                                </button>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}
