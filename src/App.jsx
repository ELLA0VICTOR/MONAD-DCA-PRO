// src/App.jsx
import React from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';

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
import ExecutionHistory from './components/DCA/ExecutionHistory';

// Dashboard Components
import Overview from './components/Dashboard/Overview';
import ActiveStrategies from './components/Dashboard/ActiveStrategies';
import PerformanceMetrics from './components/Dashboard/PerformanceMetrics';
import GasTracker from './components/Dashboard/GasTracker';

// Hooks
import { useSmartAccount } from './hooks/useSmartAccount';

// Protected Route Component
const ProtectedRoute = ({ children }) => {
  const { smartAccount, isConnected } = useSmartAccount();
  const location = useLocation();

  if (!isConnected || !smartAccount) {
    return <Navigate to="/account/create" state={{ from: location }} replace />;
  }

  return children;
};

function App() {
  return (
    <div className="app">
      <Header />

      <PageContainer>
        <Routes>
          {/* Default route */}
          <Route path="/" element={<Navigate to="/account/create" replace />} />

          {/* ───────────────────────────────
              Smart Account Routes (Public)
          ─────────────────────────────── */}
          <Route path="/account/create" element={<AccountCreator />} />
          <Route 
            path="/account/display" 
            element={
              <ProtectedRoute>
                <AccountDisplay />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/account/delegations" 
            element={
              <ProtectedRoute>
                <DelegationManager />
              </ProtectedRoute>
            } 
          />

          {/* ───────────────────────────────
              DCA Routes (Protected)
          ─────────────────────────────── */}
          <Route 
            path="/dca/strategy" 
            element={
              <ProtectedRoute>
                <StrategyBuilder />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/dca/history" 
            element={
              <ProtectedRoute>
                <ExecutionHistory />
              </ProtectedRoute>
            } 
          />

          {/* ───────────────────────────────
              Dashboard Routes (Protected)
          ─────────────────────────────── */}
          <Route 
            path="/dashboard/overview" 
            element={
              <ProtectedRoute>
                <Overview />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/dashboard/strategies" 
            element={
              <ProtectedRoute>
                <ActiveStrategies />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/dashboard/performance" 
            element={
              <ProtectedRoute>
                <PerformanceMetrics />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/dashboard/gas" 
            element={
              <ProtectedRoute>
                <GasTracker />
              </ProtectedRoute>
            } 
          />

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
                <p style={{ marginTop: '1rem' }}>
                  <a 
                    href="/account/create" 
                    style={{ 
                      color: '#00ff88',
                      textDecoration: 'none',
                      borderBottom: '1px solid #00ff88'
                    }}
                  >
                    Go to Home
                  </a>
                </p>
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