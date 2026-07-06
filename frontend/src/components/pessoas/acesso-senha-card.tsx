'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/* eslint-disable @typescript-eslint/no-explicit-any */

const selectCls = 'flex h-11 w-full rounded-md border border-input bg-card px-3 text-sm';

// Reset de senha de acesso (login por e-mail) de um colaborador — recuperação
// sem e-mail: o gestor define a nova senha aqui. RBAC no servidor.
export function AcessoSenhaCard() {
  const [pessoas, setPessoas] = useState<any[]>([]);
  const [id, setId] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    api.colaboradores().then((r: any) => setPessoas(r ?? [])).catch(() => {});
  }, []);

  const alvo = pessoas.find((p) => p.id === id);

  async function salvar() {
    if (!id) return toast.error('Escolha um colaborador.');
    if (senha.trim().length < 6) return toast.error('A senha deve ter ao menos 6 caracteres.');
    setSalvando(true);
    try {
      await api.definirSenhaColaborador(id, {
        email: email.trim() || undefined,
        senha: senha.trim(),
      });
      toast.success('Senha de acesso definida.');
      setSenha('');
      setEmail('');
      setId('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao definir senha');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Card className="p-4">
      <h2 className="font-display text-sm font-bold">Acesso &amp; senha</h2>
      <p className="mb-3 mt-0.5 text-xs text-muted-foreground">
        Defina ou redefina a senha de login (e-mail) de um colaborador — útil quando
        alguém esquece a senha. A ação fica registrada na auditoria.
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="space-y-1 sm:col-span-2">
          <Label className="text-xs">Colaborador</Label>
          <select aria-label="Colaborador" className={selectCls} value={id} onChange={(e) => setId(e.target.value)}>
            <option value="">— selecione —</option>
            {pessoas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}{p.email ? ` · ${p.email}` : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">E-mail de login {alvo?.email ? '(atual)' : '(definir)'}</Label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={alvo?.email || 'voce@empresa.com'} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Nova senha</Label>
          <Input type="text" value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="mín. 6 caracteres" />
        </div>
      </div>
      <Button type="button" className="mt-3" onClick={salvar} disabled={salvando}>
        {salvando ? 'Salvando…' : 'Definir senha'}
      </Button>
    </Card>
  );
}
