import { ReactNode } from "react";
import { Card, Text } from "@telegram-apps/telegram-ui";

import { classNames } from "@/css/classnames.ts";

import styles from "./StatCard.module.css";

type StatCardProps = {
  icon: ReactNode;
  title: string;
  value: string;
  description?: string;
  trendLabel?: string;
  trendTone?: "positive" | "negative" | "neutral";
  tone?: "default" | "warning" | "danger" | "success";
  footer?: ReactNode;
};

export function StatCard({
  icon,
  title,
  value,
  description,
  trendLabel,
  trendTone = "neutral",
  tone = "default",
  footer,
}: StatCardProps) {
  return (
    <Card className={classNames(styles.card, styles[`cardTone-${tone}`])} type="plain">
      <div className={styles.wrapper} dir="ltr">
        <div className={styles.headerRow}>
          <span className={styles.icon}>{icon}</span>
          <Text weight="2" className={styles.title}>
            {title}
          </Text>
        </div>
        <div className={styles.value}>{value}</div>
        {description && (
          <Text weight="2" className={styles.description}>
            {description}
          </Text>
        )}
        {trendLabel && (
          <span className={classNames(styles.trend, styles[`trend-${trendTone}`])}>{trendLabel}</span>
        )}
        {footer && <div className={styles.footer}>{footer}</div>}
      </div>
    </Card>
  );
}
