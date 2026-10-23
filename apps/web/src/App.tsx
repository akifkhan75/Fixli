import { Wrench, ShieldCheck, Zap, Sparkles, ArrowRight } from 'lucide-react'
import './index.css'

function App() {
  return (
    <>
      <nav className="navbar">
        <div className="container nav-content">
          <a href="/" className="nav-logo">Fixli</a>
          <div className="nav-links">
            <a href="#services" className="nav-link">Services</a>
            <a href="#professionals" className="nav-link">For Professionals</a>
            <a href="#about" className="nav-link">About</a>
            <a href="#" className="btn btn-outline">Log in</a>
            <a href="#" className="btn btn-primary">Get the App</a>
          </div>
        </div>
      </nav>

      <main>
        <section className="hero">
          <div className="hero-bg-glow"></div>
          <div className="container hero-content">
            <div className="hero-badge animate-fade-in">
              <Sparkles size={16} style={{ marginRight: 8 }} />
              The new standard in home services
            </div>
            <h1 className="hero-title animate-fade-in-delayed">
              Get it fixed.<br />Get it done.
            </h1>
            <p className="hero-subtitle animate-fade-in-delayed">
              Connect with local professionals for plumbing, electrical and other repairs. Describe the problem, add a photo, choose a price, and pay in cash when the job is done.
            </p>
            <div className="hero-actions animate-fade-in-delayed">
              <a href="#" className="btn btn-primary">
                Book a Service
                <ArrowRight size={18} style={{ marginLeft: 8 }} />
              </a>
              <a href="#how-it-works" className="btn btn-outline">
                See How It Works
              </a>
            </div>
          </div>
        </section>

        <section id="services" className="features">
          <div className="container">
            <h2 className="hero-title" style={{ fontSize: '48px', textAlign: 'center', marginBottom: 64 }}>Why Fixli?</h2>
            
            <div className="features-grid">
              <div className="feature-card">
                <div className="feature-icon">
                  <Zap size={24} />
                </div>
                <h3 className="feature-title">Quick to ask</h3>
                <p className="feature-text">No more typing long paragraphs. Tap on your problem, add a photo, and get prices from professionals near you.</p>
              </div>

              <div className="feature-card">
                <div className="feature-icon">
                  <ShieldCheck size={24} />
                </div>
                <h3 className="feature-title">ID-checked Professionals</h3>
                <p className="feature-text">Every professional on Fixli has had their ID checked by our team, and customers rate every job.</p>
              </div>

              <div className="feature-card">
                <div className="feature-icon">
                  <Wrench size={24} />
                </div>
                <h3 className="feature-title">Fair Pricing</h3>
                <p className="feature-text">You see each professional's price before you choose, and extra work must be approved by you first. You pay in cash, directly to the professional.</p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="container">
          <a href="/privacy.html">Privacy policy</a>
          <a href="/terms.html">Terms of service</a>
          <a href="/delete-account.html">Delete your account</a>
          <a href="/ur/privacy.html" lang="ur">اردو</a>
        </div>
      </footer>
    </>
  )
}

export default App
