import type { CSSProperties, FC } from 'react';
import styles from './Skeleton.module.css';

interface SkeletonProps {
    className?: string;
    style?: CSSProperties;
    width?: string | number;
    height?: string | number;
    variant?: 'rect' | 'circle' | 'text';
}

export const Skeleton: FC<SkeletonProps> = ({
    className,
    style,
    width,
    height,
    variant = 'rect',
}) => {
    const inlineStyles: CSSProperties = {
        width,
        height,
        borderRadius: variant === 'circle' ? '50%' : variant === 'text' ? '4px' : undefined,
        ...style,
    };

    return (
        <div
            className={`${styles.skeleton} ${className || ''}`}
            style={inlineStyles}
            aria-hidden="true"
        />
    );
};
