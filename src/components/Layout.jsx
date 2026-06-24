export const Layout = ({ children, activeTab, setActiveTab }) => (
  <div className="max-w-[480px] mx-auto min-h-screen flex flex-col p-4">
    <nav className="flex bg-[var(--card-bg)] p-1 rounded-2xl mb-6 shadow-xl">
      {['list', 'matrix'].map(tab => (
        <button 
          key={tab}
          onClick={() => setActiveTab(tab)}
          className={`flex-1 py-3 rounded-xl font-bold capitalize ${activeTab === tab ? 'bg-[var(--accent)] text-black' : 'text-[var(--text)]'}`}>
          {tab}
        </button>
      ))}
    </nav>
    <main className="flex-1">{children}</main>
  </div>
);