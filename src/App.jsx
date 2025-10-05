// src/App.jsx
import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';

// Layout
import Header from './components/Layout/Header';
import Footer from './components/Layout/Footer';
import { PageContainer } from './components/Layout/Container';

// Smart Account Components
import AccountCreator from './components/SmartAccount/AccountCreator';
import AccountDisplay from './components/SmartAccount/AccountDisplay';
import DelegationManager from './components/SmartAccount/DelegationManager';

// DCA Components
import StrategyBuilder from './components/DCA/StrategyBuilder';
import ScheduleSelector from './components/DCA/ScheduleSelector';
import TokenSelector from './components/DCA/TokenSelector';
import ExecutionHistory from './components/DCA/ExecutionHistory';

// Dashboard Components
import Overview from './components/Dashboard/Overview';
import ActiveStrategies from './components/Dashboard/ActiveStrategies';
import PerformanceMetrics from './components/Dashboard/PerformanceMetrics';
import GasTracker from './components/Dashboard/GasTracker';

function App() {
  return (
    <div className="app">
      <Header />

      {/* Page container handles layout width, centering, and animation */}
      <PageContainer>
        <Routes>
          {/* Default route */}
          <Route path="/" element={<Navigate to="/account/create" replace />} />

          {/* Smart Account Routes */}
          <Route path="/account/create" element={<AccountCreator />} />
          <Route path="/account/display" element={<AccountDisplay />} />
          <Route path="/account/delegations" element={<DelegationManager />} />

          {/* ───────────────────────────────
              DCA Routes
          ─────────────────────────────── */}
          <Route path="/dca/strategy" element={<StrategyBuilder />} />
          <Route path="/dca/schedule" element={<ScheduleSelector />} />
          <Route path="/dca/tokens" element={<TokenSelector />} />
          <Route path="/dca/history" element={<ExecutionHistory />} />

          {/* ───────────────────────────────
              Dashboard Routes
          ─────────────────────────────── */}
          <Route path="/dashboard/overview" element={<Overview />} />
          <Route path="/dashboard/strategies" element={<ActiveStrategies />} />
          <Route path="/dashboard/performance" element={<PerformanceMetrics />} />
          <Route path="/dashboard/gas" element={<GasTracker />} />

          {/* 404 fallback */}
          <Route
            path="*"
            element={
              <div
                style={{
                  textAlign: 'center',
                  padding: '4rem 1rem',
                  color: 'rgba(255,255,255,0.6)',
                }}
              >
                <h1 style={{ fontSize: '3rem', marginBottom: '1rem' }}>404</h1>
                <p>Page not found</p>
              </div>
            }
          />
        </Routes>
      </PageContainer>

      <Footer />
    </div>
  );
}

export default App;
