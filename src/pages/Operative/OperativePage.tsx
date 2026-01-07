import { useState } from 'react';
import { useLaunchParams } from '@telegram-apps/sdk-react';
import { GamifiedProfileBar } from '@/components/Profile/GamifiedProfileBar';
import { Skeleton } from '@/components/UI/Skeleton';
import styles from './OperativePage.module.css';

// Mock Data
const MOCK_MISSIONS = [
    { id: 1, title: 'Secure First Group', reward: '+50 XP', completed: true },
    { id: 2, title: 'Enable Anti-Spam', reward: '+100 XP', completed: false },
    { id: 3, title: 'Invite a Friend', reward: '+200 XP', completed: false },
];

export function OperativePage() {
    const lp = useLaunchParams();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = (lp.initData as any)?.user;
    const [activeTab, setActiveTab] = useState<'missions' | 'badges' | 'stats'>('missions');

    if (!user) {
        return (
            <div className={styles.page}>
                <Skeleton height="150px" />
                <Skeleton height="300px" />
            </div>
        );
    }

    return (
        <div className={styles.page}>
            {/* Header Section */}
            <section className={styles.header}>
                <div className={styles.identityRow}>
                    <div className={styles.avatarContainer}>
                        {user.photoUrl ? (
                            <img src={user.photoUrl} alt="User" className={styles.avatar} />
                        ) : (
                            <div className={styles.avatar} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666' }}>?</div>
                        )}
                    </div>
                    <div className={styles.userInfo}>
                        <span className={styles.userName}>{user.firstName} {user.lastName}</span>
                        <span className={styles.userRank}>COMMANDER LVL. 3</span>
                    </div>
                </div>

                <GamifiedProfileBar
                    level={3}
                    currentXP={350}
                    maxXP={1000}
                    badges={['🛡️', '⚡', '🏆']}
                />
            </section>

            {/* Navigation Tabs */}
            <nav className={styles.tabs}>
                <button
                    className={`${styles.tab} ${activeTab === 'missions' ? styles.tabActive : ''}`}
                    onClick={() => setActiveTab('missions')}
                >
                    MISSIONS
                </button>
                <button
                    className={`${styles.tab} ${activeTab === 'badges' ? styles.tabActive : ''}`}
                    onClick={() => setActiveTab('badges')}
                >
                    BADGES
                </button>
                <button
                    className={`${styles.tab} ${activeTab === 'stats' ? styles.tabActive : ''}`}
                    onClick={() => setActiveTab('stats')}
                >
                    STATS
                </button>
            </nav>

            {/* Content Area */}
            <main className={styles.contentArea}>
                {activeTab === 'missions' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {MOCK_MISSIONS.map(mission => (
                            <div key={mission.id} className={styles.missionCard}>
                                <div className={`${styles.missionCheckbox} ${mission.completed ? styles.completed : ''}`}>
                                    {mission.completed && '✓'}
                                </div>
                                <div className={styles.missionInfo}>
                                    <div className={styles.missionTitle}>{mission.title}</div>
                                    <div className={styles.missionReward}>{mission.reward}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {activeTab === 'badges' && (
                    <div style={{ textAlign: 'center', color: '#888', padding: '40px' }}>
                        NO NEW BADGES DETECTED
                    </div>
                )}

                {activeTab === 'stats' && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                        <Skeleton height="100px" />
                        <Skeleton height="100px" />
                        <Skeleton height="100px" />
                        <Skeleton height="100px" />
                    </div>
                )}
            </main>
        </div>
    );
}
