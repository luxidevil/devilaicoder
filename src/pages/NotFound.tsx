import { Link } from 'wouter';
import { Zap, ArrowLeft } from 'lucide-react';
import { Button } from '../components/ui/index';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="text-center">
        <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto mb-6">
          <Zap className="w-8 h-8 text-primary" />
        </div>
        <h1 className="text-4xl font-bold text-foreground mb-2 font-mono">404</h1>
        <p className="text-muted-foreground mb-8">Page not found</p>
        <Link href="/"><a><Button><ArrowLeft className="w-4 h-4 mr-2" />Back to Home</Button></a></Link>
      </div>
    </div>
  );
}
