import { Card } from "@telegram-apps/telegram-ui";

import styles from "./GroupCardSkeleton.module.css";

export function GroupCardSkeleton() {
  return (
    <Card className={styles.card} type="plain">
      <div className={styles.content} dir="ltr">
        <div className={styles.topRow}>
          <div className={styles.avatar} />
          <div className={styles.lines}>
            <div className={styles.lineLong} />
            <div className={styles.lineShort} />
          </div>
        </div>
        <div className={styles.lineFull} />
        <div className={styles.lineMedium} />
      </div>
    </Card>
  );
}
