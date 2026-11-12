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
              Instantly connect with top-rated local professionals for plumbing, electrical, and maintenance. Tap, snap a photo, and relax.
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
                <h3 className="feature-title">Lightning Fast</h3>
                <p className="feature-text">No more typing long paragraphs. Tap on your problem, snap a picture, and get offers instantly.</p>
              </div>

              <div className="feature-card">
                <div className="feature-icon">
                  <ShieldCheck size={24} />
                </div>
                <h3 className="feature-title">Vetted Professionals</h3>
                <p className="feature-text">Every worker on Fixli is background-checked, highly rated, and verified for your peace of mind.</p>
              </div>

              <div className="feature-card">
                <div className="feature-icon">
                  <Wrench size={24} />
                </div>
                <h3 className="feature-title">Fair Pricing</h3>
                <p className="feature-text">No hidden fees. Review estimated price ranges upfront and approve quotes before the job starts.</p>
              </div>
            </div>
          </div>
        </section>
      </main>
    </>
  )
}

export default App
