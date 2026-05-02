import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, AlertCircle, Eye, EyeOff, Code2, CheckCircle } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { cn } from '../lib/utils';
import { Button, Input, Label, Card, CardContent } from '../components/ui/index';

type Mode = 'signin' | 'signup';

export default function Auth() {
  const { user, authDisabled, signIn, signUp } = useAuth();
  const [, setLocation] = useLocation();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (authDisabled || user) {
      setLocation('/');
    }
  }, [authDisabled, setLocation, user]);

  const switchMode = (m: Mode) => {
    setMode(m);
    setError('');
    setSuccess('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (!email.trim() || !password.trim()) { setError('Please fill in all fields.'); return; }
    if (mode === 'signup' && !displayName.trim()) { setError('Please enter a display name.'); return; }
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }

    setLoading(true);
    if (mode === 'signin') {
      const { error: err } = await signIn(email.trim(), password);
      if (err) { setError(err); setLoading(false); return; }
      setLocation('/');
    } else {
      const { error: err } = await signUp(email.trim(), password, displayName.trim());
      if (err) { setError(err); setLoading(false); return; }
      setSuccess('Account created! You can now sign in.');
      setMode('signin');
      setPassword('');
      setDisplayName('');
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <div className="text-center mb-8">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto mb-4">
              <Code2 className="w-7 h-7 text-primary" />
            </div>
            <h1 className="text-2xl font-bold text-foreground">LUXI IDE</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {mode === 'signin' ? 'Sign in to your workspace' : 'Create your workspace'}
            </p>
          </div>

          <div className="flex rounded-lg border border-border bg-muted/30 p-1 mb-6">
            {(['signin', 'signup'] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => switchMode(m)}
                className={cn(
                  'flex-1 py-1.5 text-sm font-medium rounded-md transition-all',
                  mode === m
                    ? 'bg-card text-foreground shadow-sm border border-border'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {m === 'signin' ? 'Sign In' : 'Sign Up'}
              </button>
            ))}
          </div>

          <Card>
            <CardContent className="p-6">
              <AnimatePresence mode="wait">
                <motion.form
                  key={mode}
                  initial={{ opacity: 0, x: mode === 'signup' ? 8 : -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: mode === 'signup' ? -8 : 8 }}
                  transition={{ duration: 0.15 }}
                  onSubmit={handleSubmit}
                  className="space-y-4"
                >
                  {mode === 'signup' && (
                    <div className="space-y-1.5">
                      <Label htmlFor="displayName">Display Name</Label>
                      <Input
                        id="displayName"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder="Your name"
                        autoFocus
                        disabled={loading}
                      />
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      autoFocus={mode === 'signin'}
                      disabled={loading}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="password">Password</Label>
                    <div className="relative">
                      <Input
                        id="password"
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder={mode === 'signup' ? 'Min. 6 characters' : '••••••••'}
                        className="pr-10"
                        disabled={loading}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  {error && (
                    <div className="flex items-start gap-2 text-destructive text-sm p-3 rounded-lg bg-destructive/5 border border-destructive/20">
                      <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                      <span>{error}</span>
                    </div>
                  )}

                  {success && (
                    <div className="flex items-start gap-2 text-green-400 text-sm p-3 rounded-lg bg-green-400/5 border border-green-400/20">
                      <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                      <span>{success}</span>
                    </div>
                  )}

                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Please wait...</>
                    ) : mode === 'signin' ? 'Sign In' : 'Create Account'}
                  </Button>
                </motion.form>
              </AnimatePresence>
            </CardContent>
          </Card>

          <p className="text-center text-xs text-muted-foreground mt-4">
            {mode === 'signin' ? "Don't have an account? " : 'Already have an account? '}
            <button
              type="button"
              onClick={() => switchMode(mode === 'signin' ? 'signup' : 'signin')}
              className="text-primary hover:underline font-medium"
            >
              {mode === 'signin' ? 'Sign up' : 'Sign in'}
            </button>
          </p>
        </motion.div>
      </div>
    </div>
  );
}
