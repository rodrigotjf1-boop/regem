'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// Self-service: o próprio usuário troca a sua senha de acesso (confere a atual).
export default function TrocarSenhaPage() {
  const router = useRouter();
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [conf, setConf] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!getToken()) router.replace('/entrar');
  }, [router]);

  async function salvar() {
    if (nova.trim().length < 6) return toast.error('A nova senha deve ter ao menos 6 caracteres.');
    if (nova !== conf) return toast.error('A confirmação não confere.');
    setSalvando(true);
    try {
      await api.post('/auth/senha', { senhaAtual: atual, novaSenha: nova.trim() });
      toast.success('Senha alterada com sucesso.');
      setAtual('');
      setNova('');
      setConf('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao alterar a senha');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Shell eyebrow="Minha conta" title="Trocar minha senha">
      <div className="max-w-md">
        <Card className="space-y-3 p-4">
          <div className="space-y-1">
            <Label className="text-xs">Senha atual</Label>
            <Input type="password" value={atual} onChange={(e) => setAtual(e.target.value)} autoComplete="current-password" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Nova senha</Label>
            <Input type="password" value={nova} onChange={(e) => setNova(e.target.value)} placeholder="mín. 6 caracteres" autoComplete="new-password" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Confirmar nova senha</Label>
            <Input type="password" value={conf} onChange={(e) => setConf(e.target.value)} autoComplete="new-password" />
          </div>
          <Button type="button" onClick={salvar} disabled={salvando}>
            {salvando ? 'Salvando…' : 'Alterar senha'}
          </Button>
        </Card>
      </div>
    </Shell>
  );
}
