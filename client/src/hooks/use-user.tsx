import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";

interface User {
  id: number;
  username: string;
  role: "admin" | "dispatcher" | "driver";
}

interface AuthContextType {
  user: User | null;
  login: (username: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  useEffect(() => {
    const savedUser = localStorage.getItem("traq_user");
    if (savedUser) {
      setUser(JSON.parse(savedUser));
    } else {
      if (window.location.pathname !== "/auth") {
        setLocation("/auth");
      }
    }
  }, []);

  const login = async (username: string) => {
    const fakeUser: User = { id: 1, username, role: "admin" };
    
    setUser(fakeUser);
    localStorage.setItem("traq_user", JSON.stringify(fakeUser));
    
    toast({ title: "Welcome back!", description: `${username} is now active.` });
    setLocation("/");
  };

  const logout = async () => {
    setUser(null);
    localStorage.removeItem("traq_user");
    toast({ title: "Logged Out", description: "Session ended securely." });
    setLocation("/auth");
  };

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useUser() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useUser must be used within an AuthProvider");
  return context;
}
