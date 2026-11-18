import { Wrench, ShieldCheck, Zap, Sparkles, Banknote, Siren } from 'lucide-react'
import './index.css'

// Everything on this page describes what the app does today. There are no store links yet (they
// arrive with the EAS/store accounts, doc 25 O14); until then the call to action says so plainly
// instead of linking nowhere.
function App() {
  return (
    <>
      <nav className="navbar" aria-label="Main">
        <div className="container nav-content">
          <a href="/" className="nav-logo">Fixli</a>
          <div className="nav-links">
            <a href="#how-it-works" className="nav-link">How it works</a>
            <a href="#professionals" className="nav-link">For professionals</a>
            <a href="#safety" className="nav-link">Safety</a>
          </div>
        </div>
      </nav>

      <main>
        <section className="hero">
          <div className="hero-bg-glow"></div>
          <div className="container hero-content">
            <div className="hero-badge animate-fade-in">
              <Sparkles size={16} style={{ marginRight: 8 }} />
              Home repairs in Pakistan
            </div>
            <h1 className="hero-title animate-fade-in-delayed">
              Get it fixed.<br />Get it done.
            </h1>
            <p className="hero-subtitle animate-fade-in-delayed">
              Tell us what is wrong, see the price from each nearby professional, then choose. Plumbing, electrical and more.
            </p>
            <div className="hero-actions animate-fade-in-delayed">
              <span className="btn btn-outline" role="status">The app is coming soon to the App Store and Google Play</span>
            </div>
          </div>
        </section>

        <section id="how-it-works" className="features">
          <div className="container">
            <h2 className="hero-title" style={{ fontSize: '48px', textAlign: 'center', marginBottom: 64 }}>How it works</h2>
            <div className="features-grid">
              <div className="feature-card">
                <div className="feature-icon"><Zap size={24} /></div>
                <h3 className="feature-title">1. Tell us the problem</h3>
                <p className="feature-text">Tap what is wrong, add a photo or a voice note, and choose when you want someone to come.</p>
              </div>
              <div className="feature-card">
                <div className="feature-icon"><Wrench size={24} /></div>
                <h3 className="feature-title">2. Compare prices</h3>
                <p className="feature-text">Nearby professionals send their price and how soon they can come. You see them before you decide, and nothing is charged until you agree.</p>
              </div>
              <div className="feature-card">
                <div className="feature-icon"><Banknote size={24} /></div>
                <h3 className="feature-title">3. Pay the professional in cash</h3>
                <p className="feature-text">When the work is done, pay the agreed price directly to the professional and confirm it in the app.</p>
              </div>
            </div>
          </div>
        </section>

        <section id="professionals" className="features">
          <div className="container">
            <h2 className="hero-title" style={{ fontSize: '40px', textAlign: 'center', marginBottom: 32 }}>For professionals</h2>
            <p className="feature-text" style={{ maxWidth: 640, margin: '0 auto', textAlign: 'center' }}>
              Get requests near you, set your own price, and keep your own schedule. Our team checks your ID and a selfie before you can take jobs.
              Fixli charges a small commission on each completed job, shown in the app before you accept it.
            </p>
          </div>
        </section>

        <section id="safety" className="features">
          <div className="container">
            <div className="features-grid">
              <div className="feature-card">
                <div className="feature-icon"><ShieldCheck size={24} /></div>
                <h3 className="feature-title">ID checked</h3>
                <p className="feature-text">Every professional's ID and selfie are reviewed by our team before they can receive jobs. Reviews come only from people who booked them.</p>
              </div>
              <div className="feature-card">
                <div className="feature-icon"><Siren size={24} /></div>
                <h3 className="feature-title">An SOS button</h3>
                <p className="feature-text">One tap shows your local emergency numbers and, for urgent home problems, alerts the nearest professional first. Always call emergency services yourself if anyone is in danger.</p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="container" style={{ padding: '48px 0', display: 'flex', gap: 24, flexWrap: 'wrap', justifyContent: 'center' }}>
        <a href="/privacy.html" className="nav-link">Privacy</a>
        <a href="/terms.html" className="nav-link">Terms</a>
        <a href="/delete-account.html" className="nav-link">Delete your account</a>
      </footer>
    </>
  )
}

export default App
