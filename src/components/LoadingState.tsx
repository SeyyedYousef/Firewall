import { Skeleton } from '@/components/UI/Skeleton';

interface LoadingStateProps {
  message?: string;
  size?: 's' | 'm' | 'l';
  fullScreen?: boolean;
}

export function LoadingState({ fullScreen = false }: LoadingStateProps) {
  // Skeleton loading - no spinners
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '16px',
      padding: '24px',
      minHeight: fullScreen ? '100vh' : '100%',
      justifyContent: 'flex-start'
    }}>
      <Skeleton height="180px" />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        <Skeleton height="120px" />
        <Skeleton height="120px" />
      </div>
      <Skeleton height="60px" />
      <Skeleton height="200px" />
    </div>
  );
}

interface LoadingOverlayProps {
  isLoading: boolean;
  message?: string;
  children: React.ReactNode;
}

export function LoadingOverlay({ isLoading, children }: LoadingOverlayProps) {
  return (
    <div style={{ position: 'relative' }}>
      {children}
      {isLoading && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.7)', // Darker overlay
          backdropFilter: 'blur(4px)',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <Skeleton width="80%" height="150px" /> {/* Skeleton overlay instead of spinner box */}
        </div>
      )}
    </div>
  );
}

export function InlineLoader() {
  return (
    <div style={{ padding: '8px' }}>
      <Skeleton width="100%" height="24px" variant="text" />
    </div>
  );
}
