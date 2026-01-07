import { SecurityCard } from '@/components/Dashboard/SecurityCard';
import { PromoSlider } from '@/features/dashboard/PromoSlider';
import { useDashboardData } from '@/features/dashboard/useDashboardData';
import { LoadingState } from '@/components/LoadingState';
import { Skeleton } from '@/components/UI/Skeleton';
import styles from './DashboardPage.module.css';

// Component for Quick Stats
const QuickStat = ({ label, value, type }: { label: string, value: string, type: 'info' | 'warn' }) => (
  <div className={styles.quickStat}>
    <div className={styles.quickStatValue} data-type={type}>{value}</div>
    <div className={styles.quickStatLabel}>{label}</div>
  </div>
);

export function DashboardPage() {
  const { insights, promotions, loading } = useDashboardData();

  if (loading) return <LoadingState />;

  return (
    <div className={styles.page}>

      {/* Security Status Widget */}
      <section>
        <SecurityCard status="secure" />
      </section>

      {/* Quick Stats Grid */}
      <section className={styles.statsGrid}>
        <QuickStat
          label="THREATS BLOCKED"
          value="14,203"
          type="info"
        />
        <QuickStat
          label="MESSAGES SCANNED"
          value={insights.messagesToday.toLocaleString()}
          type="info"
        />
        <QuickStat
          label="ACTIVE MODULES"
          value="3"
          type="warn"
        />
        <QuickStat
          label="SYSTEM UPTIME"
          value="99.9%"
          type="info"
        />
      </section>

      {/* Holo-News Slider */}
      {promotions.slots.length > 0 && (
        <section className={styles.newsSection}>
          <h3 className={styles.sectionTitle}>INTELLIGENCE FEED</h3>
          <div className={styles.sliderContainer}>
            <PromoSlider
              slots={promotions.slots}
              rotationSeconds={5}
              metadata={promotions.metadata}
            />
          </div>
        </section>
      )}

    </div>
  );
}
