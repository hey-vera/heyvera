import { PageShell } from "./components/layout/PageShell";
import { Footer } from "./components/public/Footer";
import { FoundingNetwork } from "./components/public/FoundingNetwork";
import { GetStarted } from "./components/public/GetStarted";
import { Hero } from "./components/public/Hero";
import { HowItWorks } from "./components/public/HowItWorks";
import { Navbar } from "./components/public/Navbar";
import { Problem } from "./components/public/Problem";
import { SurfaceMap } from "./components/public/SurfaceMap";
import { ThreePillars } from "./components/public/ThreePillars";

function App() {
  return (
    <PageShell>
      <Navbar />
      <Hero />
      <Problem />
      <SurfaceMap />
      <ThreePillars />
      <HowItWorks />
      <FoundingNetwork />
      <GetStarted />
      <Footer />
    </PageShell>
  );
}

export default App;
