import { Switch, Route, useLocation } from 'wouter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './lib/auth';
import Home from './pages/Home';
import IDE from './pages/IDE';
import Admin from './pages/Admin';
import Auth from './pages/Auth';
import NotFound from './pages/NotFound';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30000 } } });

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, loading } = useAuth();
  const [, setLocation] = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    setLocation('/auth');
    return null;
  }

  return <Component />;
}

function Routes() {
  return (
    <Switch>
      <Route path="/auth" component={Auth} />
      <Route path="/" component={() => <ProtectedRoute component={Home} />} />
      <Route path="/projects/:id" component={() => <ProtectedRoute component={IDE} />} />
      <Route path="/admin" component={() => <ProtectedRoute component={Admin} />} />
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Routes />
      </AuthProvider>
    </QueryClientProvider>
  );
}
