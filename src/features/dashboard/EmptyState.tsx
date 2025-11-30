import { openLink, hapticFeedback } from '@telegram-apps/sdk-react';
import { Button, Text } from '@telegram-apps/telegram-ui';
import Lottie from 'lottie-react';

import { useTgsAnimation } from '@/hooks/useTgsAnimation.ts';

import styles from './EmptyState.module.css';

type EmptyStateProps = {
  inviteUrl?: string;
  onInvite?: () => void;
};

const NO_GROUPS_TGS = new URL('../../../assets/lottie/no-groups.tgs', import.meta.url).href;

// Default invite URL with the production bot username
const DEFAULT_INVITE_URL = 'https://t.me/FirewallMainBot?startgroup=start&admin=delete_messages+restrict_members+invite_users';

export function EmptyState({ inviteUrl, onInvite }: EmptyStateProps) {
  const { data, isLoading } = useTgsAnimation<Record<string, unknown>>(NO_GROUPS_TGS);
  
  // Use provided URL, fallback to default
  const effectiveInviteUrl = inviteUrl || DEFAULT_INVITE_URL;

  const handleInvite = () => {
    hapticFeedback.impactOccurred('light');
    void openLink(effectiveInviteUrl);
    onInvite?.();
  };

  return (
    <div className={styles.wrapper} dir='ltr'>
      <div className={styles.container}>
        <div className={styles.animationContainer}>
          {data && <Lottie animationData={data} loop autoplay />}
          {!data && isLoading && <div className={styles.loader} />}
        </div>
        
        <div className={styles.content}>
          <h2 className={styles.title}>🛡️ No Managed Groups Yet</h2>
          <Text weight='2' className={styles.description}>
            Add Firewall Bot to your Telegram group to protect it from spam, manage members, and see detailed analytics.
          </Text>
          
          <div className={styles.features}>
            <div className={styles.featureItem}>
              <span className={styles.featureIcon}>🚫</span>
              <span>Block spam & ads</span>
            </div>
            <div className={styles.featureItem}>
              <span className={styles.featureIcon}>👥</span>
              <span>Manage members</span>
            </div>
            <div className={styles.featureItem}>
              <span className={styles.featureIcon}>📊</span>
              <span>View analytics</span>
            </div>
          </div>
        </div>
        
        <Button
          className={styles.cta}
          mode='filled'
          size='l'
          stretched
          onClick={handleInvite}
        >
          ➕ Add Bot to Group
        </Button>
        
        <Text weight='3' className={styles.hint}>
          Make sure you're an admin in the group you want to add the bot to.
        </Text>
      </div>
    </div>
  );
}


