import { Switch, Route, Router as WouterRouter } from "wouter";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import DiagnosticPage from "@/pages/diagnostic";
import ParcoursPage from "@/pages/parcours";
import GuidePage from "@/pages/guide";
import { MotionConfig } from "framer-motion";

function Router() {
  return (
    <Switch>
      <Route path="/" component={ParcoursPage} />
      <Route path="/diagnostic" component={DiagnosticPage} />
      <Route path="/guide" component={GuidePage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <MotionConfig reducedMotion="user">
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </MotionConfig>
  );
}

export default App;
