import { useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import Header from './components/Layout/Header';
import Footer from './components/Layout/Footer';
import SmartAccountTab from './components/Tabs/SmartAccountTab';
import DelegationTab from './components/Tabs/DelegationTab';
import SwapTab from './components/Tabs/SwapTab';
import TasksTab from './components/Tabs/TasksTab';
import DashboardTab from './components/Tabs/DashboardTab';
import ExecutionHistoryTab from './components/Tabs/ExecutionHistoryTab';
import DepositModal from './components/Modals/DepositModal';
import WithdrawModal from './components/Modals/WithdrawModal';
import ConfirmModal from './components/Modals/ConfirmModal';
import AIRecommendationModal from './components/Modals/AIRecommendationModal';
import { useSmartAccount } from './hooks/useSmartAccount';
import { useWallet } from './hooks/useWallet';

function App() {
  const { isConnected: walletConnected } = useWallet();
  const { activeAccount } = useSmartAccount();
  
  // Tab state
  const [activeTab, setActiveTab] = useState('smart-account');
  
  // Modal states
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showAIModal, setShowAIModal] = useState(false);
  const [aiRecommendation, setAIRecommendation] = useState(null);
  const [confirmConfig, setConfirmConfig] = useState(null);

  // Handlers
  const handleTabChange = (tab) => {
    setActiveTab(tab);
  };

  const handleOpenDeposit = () => {
    setShowDepositModal(true);
  };

  const handleOpenWithdraw = () => {
    setShowWithdrawModal(true);
  };

  const handleShowAIRecommendation = (recommendation) => {
    setAIRecommendation(recommendation);
    setShowAIModal(true);
  };

  const handleShowConfirm = (config) => {
    setConfirmConfig(config);
    setShowConfirmModal(true);
  };

  // Render active tab
  const renderActiveTab = () => {
    switch (activeTab) {
      case 'smart-account':
        return (
          <SmartAccountTab
            onOpenDeposit={handleOpenDeposit}
            onOpenWithdraw={handleOpenWithdraw}
          />
        );
      case 'delegations':
        return <DelegationTab />;
      case 'swap':
        return (
          <SwapTab
            onShowAIRecommendation={handleShowAIRecommendation}
          />
        );
      case 'tasks':
        return <TasksTab onTaskClick={(task) => console.log('Task clicked:', task)} />;
      case 'dashboard':
        return <DashboardTab />;
      case 'history':
        return <ExecutionHistoryTab />;
      default:
        return <SmartAccountTab />;
    }
  };

  return (
    <div style={styles.app}>
      <Header
        activeTab={activeTab}
        onTabChange={handleTabChange}
        walletConnected={walletConnected}
      />

      <main style={styles.main}>
        <AnimatePresence mode="wait">
          {renderActiveTab()}
        </AnimatePresence>
      </main>

      <Footer />

      {/* Modals */}
      <AnimatePresence>
        {showDepositModal && (
          <DepositModal
            isOpen={showDepositModal}
            onClose={() => setShowDepositModal(false)}
            smartAccountAddress={activeAccount?.address}
          />
        )}
        {showWithdrawModal && (
          <WithdrawModal
            isOpen={showWithdrawModal}
            onClose={() => setShowWithdrawModal(false)}
            smartAccount={activeAccount}
          />
        )}
        {showConfirmModal && confirmConfig && (
          <ConfirmModal
            isOpen={showConfirmModal}
            onClose={() => setShowConfirmModal(false)}
            {...confirmConfig}
          />
        )}
        {showAIModal && aiRecommendation && (
          <AIRecommendationModal
            isOpen={showAIModal}
            onClose={() => setShowAIModal(false)}
            recommendation={aiRecommendation}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

const styles = {
  app: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--bg-primary)',
  },
  main: {
    flex: 1,
    paddingTop: '80px', // Account for fixed header
    paddingBottom: '2rem',
  },
};

export default App;