import React from 'react';

interface TopLoadingBarProps {
    isLoading: boolean;
}

export const TopLoadingBar: React.FC<TopLoadingBarProps> = ({ isLoading }) => {
    if (!isLoading) return null;

    return (
        <div className="fixed top-0 left-0 right-0 z-[9999] h-[2.5px] bg-card-secondary overflow-hidden pointer-events-none">
            <div className="w-1/2 h-full bg-gradient-to-r from-transparent via-cyan-400 via-blue-500 to-transparent shadow-[0_0_14px_rgba(56,189,248,0.9)] animate-laser" />
        </div>
    );
};

export default TopLoadingBar;
