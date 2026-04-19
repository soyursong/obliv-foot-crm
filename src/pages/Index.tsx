import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function Index() {
  const navigate = useNavigate();

  useEffect(() => {
    navigate('/jongno-longlasting');
  }, [navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <p className="text-muted-foreground">Redirecting...</p>
    </div>
  );
}
