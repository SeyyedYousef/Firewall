import { Placeholder, Spinner } from '@telegram-apps/telegram-ui';

interface LoadingStateProps {
  message?: string;
  size?: 's' | 'm' | 'l';
  fullScreen?: boolean;
}

export function LoadingState({ 
  message = 'Loading...', 
  size = 'm',
  fullScreen = false 
}: LoadingStateProps) {
  if (fullScreen) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        padding: '20px'
      }}>
        <Spinner size={size} />
        {message && (
          <p style={{ marginTop: '16px', opacity: 0.7 }}>
            {message}
          </p>
        )}
      </div>
    );
  }

  return (
    <Placeholder
      description={
        <div style={{ textAlign: 'center' }}>
          <Spinner size={size} />
          {message && (
            <p style={{ marginTop: '16px', opacity: 0.7 }}>
              {message}
            </p>
          )}
        </div>
      }
    />
  );
}

interface LoadingOverlayProps {
  isLoading: boolean;
  message?: string;
  children: React.ReactNode;
}

export function LoadingOverlay({ isLoading, message, children }: LoadingOverlayProps) {
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
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          zIndex: 1000
        }}>
          <div style={{
            backgroundColor: 'var(--tgui--bg_color, #fff)',
            padding: '24px',
            borderRadius: '12px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '12px'
          }}>
            <Spinner size="m" />
            {message && <p>{message}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

export function InlineLoader({ message }: { message?: string }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '12px'
    }}>
      <Spinner size="s" />
      {message && <span style={{ fontSize: '14px', opacity: 0.7 }}>{message}</span>}
    </div>
  );
}
