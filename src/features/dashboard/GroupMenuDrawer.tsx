import { Button, Text } from "@telegram-apps/telegram-ui";
import { hapticFeedback } from "@telegram-apps/sdk-react";

import { classNames } from "@/css/classnames.ts";

import styles from "./GroupMenuDrawer.module.css";

type MenuItem = {
  key: string;
  icon: string;
  label: string;
};

type GroupMenuDrawerProps = {
  open: boolean;
  onClose: () => void;
  activeKey?: string;
  onSelect?: (key: string) => void;
};

const MENU_ITEMS: MenuItem[] = [
  { key: "home", icon: "🏠", label: "Dashboard" },
  { key: "settings", icon: "⚙️", label: "General settings" },
  { key: "bans", icon: "🛡️", label: "Content restrictions" },
  { key: "limits", icon: "📏", label: "Limits" },
  { key: "mute", icon: "🔕", label: "Quiet hours" },
  { key: "mandatory", icon: "📌", label: "Mandatory membership" },
  { key: "texts", icon: "💬", label: "Custom messages" },
  { key: "analytics", icon: "📊", label: "Analytics" },
  { key: "stars", icon: "⭐", label: "Active Premium" },
];

export function GroupMenuDrawer({ open, onClose, activeKey = "home", onSelect }: GroupMenuDrawerProps) {
  return (
    <div className={classNames(styles.overlay, open && styles.overlayVisible)} onClick={onClose}>
      <div
        className={classNames(styles.drawer, open && styles.drawerVisible)}
        dir="ltr"
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.header}>
          <Text weight="3" style={{ color: '#fff' }}>
            Group management
          </Text>
          <Button
            mode="plain"
            size="s"
            onClick={() => {
              hapticFeedback.impactOccurred('light');
              onClose();
            }}
            className={styles.closeButton}
            data-testid="menu-close-button"
          >
            Close
          </Button>
        </div>
        <div className={styles.list}>
          {MENU_ITEMS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={classNames(styles.item, activeKey === item.key && styles.itemActive)}
              onClick={() => {
                hapticFeedback.impactOccurred('light');
                onSelect?.(item.key);
                onClose();
              }}
            >
              <span className={styles.itemIcon}>{item.icon}</span>
              <span className={styles.itemLabel}>{item.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
