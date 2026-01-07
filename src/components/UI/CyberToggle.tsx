import type { ChangeEvent, FC } from 'react';
import { hapticFeedback } from '@telegram-apps/sdk-react';
import styles from './CyberToggle.module.css';

interface CyberToggleProps {
    checked: boolean;
    onChange: (checked: boolean) => void;
    disabled?: boolean;
}

export const CyberToggle: FC<CyberToggleProps> = ({ checked, onChange, disabled }) => {
    const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
        const newChecked = e.target.checked;

        // Haptic Feedback
        try {
            if (hapticFeedback.impactOccurred.isAvailable()) {
                hapticFeedback.impactOccurred('medium');
            }
        } catch { /* ignore */ }

        onChange(newChecked);
    };

    return (
        <label className={styles.label}>
            <input
                type="checkbox"
                className={styles.input}
                checked={checked}
                onChange={handleChange}
                disabled={disabled}
            />
            <span className={styles.slider} />
        </label>
    );
};
