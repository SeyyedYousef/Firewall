import { useNavigate } from 'react-router-dom';
import { useDashboardData } from '@/features/dashboard/useDashboardData';
import { LoadingState } from '@/components/LoadingState';
import { Skeleton } from '@/components/UI/Skeleton';
import styles from './ConfigPage.module.css';

export function ConfigPage() {
    const navigate = useNavigate();
    const { groups, loading } = useDashboardData();

    if (loading) {
        return (
            <div className={styles.page}>
                <div className={styles.header}>
                    <Skeleton width="150px" height="30px" />
                    <Skeleton width="200px" height="20px" style={{ marginTop: 8 }} />
                </div>
                <div className={styles.serverList}>
                    <Skeleton height="80px" />
                    <Skeleton height="80px" />
                    <Skeleton height="80px" />
                </div>
            </div>
        );
    }

    return (
        <div className={styles.page}>
            <header className={styles.header}>
                <h1 className={styles.title}>Network Config</h1>
                <p className={styles.subtitle}>Manage your active server modules</p>
            </header>

            <div className={styles.serverList}>
                {groups.length === 0 ? (
                    <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>
                        NO ACTIVE SERVERS DETECTED
                    </div>
                ) : (
                    groups.map(group => {
                        const isActive = group.status.kind === 'active';
                        const statusClass = isActive ? styles.active : styles.expired;

                        return (
                            <div key={group.id} className={`${styles.serverModule} ${statusClass}`}>
                                <div className={styles.moduleInfo}>
                                    <div className={styles.moduleIcon}>
                                        {group.photoUrl ? <img src={group.photoUrl} alt="" style={{ width: '100%', height: '100%', borderRadius: 8 }} /> : '#'}
                                    </div>
                                    <div className={styles.moduleDetails}>
                                        <div className={styles.moduleName}>{group.title}</div>
                                        <div className={styles.moduleStatus}>
                                            <span className={`${styles.led} ${isActive ? styles.on : styles.off}`} />
                                            {isActive ? 'ONLINE' : 'OFFLINE'}
                                            <span style={{ opacity: 0.5 }}> • {group.membersCount} NODES</span>
                                        </div>
                                    </div>
                                </div>

                                <button
                                    className={styles.actionButton}
                                    onClick={() => navigate(`/groups/${group.id}`)}
                                >
                                    ACCESS
                                </button>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}
