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

function App() {
  return (
    <div className="app">
      <Header />

      <PageContainer>
        <Routes>
          {/* Default route */}
          <Route path="/" element={<Navigate to="/account/create" replace />} />

          {/* Smart Account Routes */}
          <Route path="/account/create" element={<AccountCreator />} />
          <Route path="/account/display" element={<AccountDisplay />} />
          <Route path="/account/delegations" element={<DelegationManager />} />

          {/* TODO: Add DCA + Dashboard routes once components are generated */}

          {/* 404 fallback */}
          <Route 
            path="*" 
            element={
              <div style={{ textAlign: 'center', padding: '4rem 1rem', color: 'rgba(255,255,255,0.6)' }}>
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
