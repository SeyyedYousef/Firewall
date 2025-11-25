import { Button, Placeholder } from '@telegram-apps/telegram-ui';
import { useNavigate } from 'react-router-dom';

interface ErrorFallbackProps {
  error: unknown;
}

export function ErrorFallback({ error }: ErrorFallbackProps) {
  const navigate = useNavigate();
  
  const errorMessage = error instanceof Error 
    ? error.message 
    : 'An unexpected error occurred';

  const handleReload = () => {
    window.location.reload();
  };

  const handleGoHome = () => {
    navigate('/');
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      padding: '20px',
      textAlign: 'center'
    }}>
      <Placeholder
        header="⚠️ Something went wrong"
        description={
          <div style={{ maxWidth: '400px', margin: '0 auto' }}>
            <p style={{ marginBottom: '12px' }}>
              {errorMessage}
            </p>
            <p style={{ fontSize: '14px', opacity: 0.7 }}>
              Don't worry! You can try reloading the page or return to the home screen.
            </p>
          </div>
        }
      >
        <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
          <Button mode="filled" size="m" onClick={handleReload}>
            🔄 Reload Page
          </Button>
          <Button mode="outline" size="m" onClick={handleGoHome}>
            🏠 Go Home
          </Button>
        </div>
      </Placeholder>
    </div>
  );
}
