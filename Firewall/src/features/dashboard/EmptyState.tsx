import { openLink } from '@telegram-apps/sdk-react';
import { Button, Placeholder, Text } from '@telegram-apps/telegram-ui';
import Lottie from 'lottie-react';

import { useTgsAnimation } from '@/hooks/useTgsAnimation.ts';

import styles from './EmptyState.module.css';

type EmptyStateProps = {
  inviteUrl?: string;
  onInvite?: () => void;
};

const NO_GROUPS_TGS = new URL('../../../assets/lottie/no-groups.tgs', import.meta.url).href;

export function EmptyState({ inviteUrl, onInvite }: EmptyStateProps) {
  const { data, isLoading } = useTgsAnimation<Record<string, unknown>>(NO_GROUPS_TGS);

  const handleInvite = () => {
    if (inviteUrl) {
      void openLink(inviteUrl);
      return;
    }
    onInvite?.();
  };

  return (
    <div className={styles.wrapper} dir='ltr'>
      <Placeholder
        className={styles.placeholder}
        header='No managed groups yet'
        description={
          <Text weight='2' className={styles.description}>
            Add the Firewall bot to a Telegram group to see health stats and quick actions here.
          </Text>
        }
      >
        <div className={styles.animationContainer}>
          {data && <Lottie animationData={data} loop autoplay />}
          {!data && isLoading && <div className={styles.loader} />}
        </div>
        <Button
          className={styles.cta}
          mode='filled'
          size='l'
          stretched
          onClick={handleInvite}
          disabled={!inviteUrl && !onInvite}
        >
          ? Add bot to a group
        </Button>
      </Placeholder>
    </div>
  );
}


