import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { 
  ArrowLeft, Search, 
  UserCircle, MessageSquare, LayoutGrid, BarChart2, NotebookPen
} from 'lucide-react';
import { getMediaUrl } from '../utils/media';

interface LayoutProps {
  children: React.ReactNode;
  title?: string;
  showBackButton?: boolean;
  onSearchClick?: () => void;
  onTitleClick?: () => void;
  avatarUrl?: string;
  subtitle?: string;
  showTabs?: boolean;
}


const Layout: React.FC<LayoutProps> = ({ 
  children, 
  title, 
  showBackButton = false, 
  onSearchClick,
  onTitleClick,
  avatarUrl,
  subtitle
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const isChat = location.pathname.includes('/chat/');
  const chatId = isChat ? location.pathname.split('/').pop() : null;

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);
  
  const navItems = [
    { label: 'Conversas', icon: MessageSquare, path: '/' },
    { label: 'Atividades', icon: LayoutGrid, path: '/atividades' },
    { label: 'Anotações', icon: NotebookPen, path: '/anotacoes' },
    { label: 'Custos', icon: BarChart2, path: '/dashboard' },
    { label: 'Perfil', icon: UserCircle, path: '/configuracoes' },
  ];

  return (
    <div className="flex flex-col h-screen bg-white max-w-md mx-auto relative overflow-hidden font-sans">
      {/* Top Header (WhatsApp Style - Fiel) */}
      <header className="bg-whatsapp-teal text-white px-2 py-2.5 shadow-md z-[70] flex items-center justify-between">
        <div className="flex items-center flex-1 overflow-hidden">
          {showBackButton && (
            <button 
              onClick={() => navigate(-1)} 
              className="p-1 active:bg-white/20 rounded-full transition-all flex items-center justify-center h-10 w-10 shrink-0"
            >
              <ArrowLeft size={24} />
            </button>
          )}
          <div 
            onClick={onTitleClick} 
            className={`flex items-center gap-2.5 flex-1 overflow-hidden ${onTitleClick ? 'cursor-pointer active:bg-white/10 rounded-xl px-2 py-1 transition-all' : 'px-2'}`}
          >
            {avatarUrl && (
              <img 
                src={getMediaUrl(avatarUrl)} 
                alt="Avatar" 
                className="w-10 h-10 rounded-full object-cover border border-white/20 shrink-0 bg-white/10" 
              />
            )}
            <div className="flex flex-col overflow-hidden">
              <h1 className="text-lg font-medium tracking-tight leading-tight truncate">
                {title || 'AgroCafé'}
              </h1>
              {subtitle && (
                <span className="text-[12px] text-white/80 leading-tight truncate font-medium">{subtitle}</span>
              )}
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-1">
          {onSearchClick && (
            <button 
              onClick={onSearchClick}
              className="p-2 active:bg-white/20 rounded-full transition-all"
            >
              <Search size={22} />
            </button>
          )}
          <div className="relative" ref={menuRef}>
            <button 
              onClick={() => setShowMenu(!showMenu)}
              className="p-2 active:bg-white/20 rounded-full transition-all"
            >
              <MoreVertical size={22} />
            </button>
            
            {showMenu && (
              <div className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-lg border border-gray-100 py-2 z-[100] animate-in fade-in slide-in-from-top-2">
                {isChat && chatId ? (
                  <>
                    <button 
                      onClick={() => { setShowMenu(false); navigate(`/lavoura/${chatId}/perfil`); }}
                      className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 active:bg-gray-100 font-medium"
                    >
                      Detalhes do Talhão
                    </button>
                    <button 
                      onClick={() => { setShowMenu(false); navigate('/atividades'); }}
                      className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 active:bg-gray-100 font-medium"
                    >
                      Todas as Atividades
                    </button>
                  </>
                ) : (
                  <>
                    <button 
                      onClick={() => { setShowMenu(false); navigate('/configuracoes'); }}
                      className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 active:bg-gray-100 font-medium"
                    >
                      Configurações
                    </button>
                    <button 
                      onClick={() => { setShowMenu(false); navigate('/dashboard'); }}
                      className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 active:bg-gray-100 font-medium"
                    >
                      Relatórios
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto bg-[#F0F2F5] relative pb-24 no-scrollbar">
        {children}
      </main>

      {/* Bottom Navigation Bar (WHATSAPP PREMIUM STYLE) */}
      {!isChat && (
        <nav className="bg-white/90 backdrop-blur-md border-t border-gray-100 fixed bottom-0 left-0 right-0 max-w-md mx-auto flex justify-around items-center z-[80] py-1 shadow-[0_-4px_12px_rgba(0,0,0,0.03)]">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path || 
                           (item.path !== '/' && location.pathname.startsWith(item.path));
            const Icon = item.icon;
            
            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className="flex flex-col items-center justify-center flex-1 min-w-0 px-1 py-1 transition-all group"
              >
                <div className="relative flex flex-col items-center gap-1 transition-all w-full min-w-0">
                  {/* px-3 (não px-5): com 5 abas o slot de cada item é ~64px e a
                      pílula de 62px empurrava o vizinho, desalinhando a barra. */}
                  <div className={`px-3 py-1 rounded-full transition-all duration-300 ${isActive ? 'bg-whatsapp-teal/10' : 'group-active:bg-gray-100'}`}>
                    <Icon 
                      size={22} 
                      className={`transition-colors duration-300 ${isActive ? 'text-whatsapp-teal' : 'text-gray-500'}`}
                      strokeWidth={isActive ? 2.5 : 2}
                    />
                  </div>
                  {/* nowrap truca em uma linha só: label quebrado em duas linhas
                      alterava a altura do slot e deixava os ícones desencontrados. */}
                  <span className={`text-[10px] font-medium transition-colors duration-300 whitespace-nowrap max-w-full overflow-hidden text-ellipsis ${isActive ? 'text-whatsapp-teal font-bold' : 'text-gray-500'}`}>
                    {item.label}
                  </span>
                </div>
              </button>
            );
          })}
        </nav>
      )}
    </div>
  );
};

// Icone customizado para simular o MoreVertical do Lucide que faltou no import anterior
const MoreVertical = ({ size, className }: { size: number; className?: string }) => (
  <svg 
    width={size} height={size} viewBox="0 0 24 24" fill="none" 
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" 
    strokeLinejoin="round" className={className}
  >
    <circle cx="12" cy="12" r="1" /><circle cx="12" cy="5" r="1" /><circle cx="12" cy="19" r="1" />
  </svg>
);

export default Layout;
