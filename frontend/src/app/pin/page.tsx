'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Delete } from 'lucide-react';
import { api, setToken } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { RegemMark } from '@/components/brand/regem-mark';

const UNIT_KEY = 'regen_unidade';

export default function PinPage() {
  const router = useRouter();
  const [unidadeId, setUnidadeId] = useState('');
  const [saved, setSaved] = useState(false);
  const [ready, setReady] = useState(false);
  const [pin, setPin] = useState('');
  const [erro, setErro] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const u = localStorage.getItem(UNIT_KEY) ?? '';
    setUnidadeId(u);
    setSaved(!!u);
    setReady(true);
  }, []);

  function salvarUnidade(e: React.FormEvent) {
    e.preventDefault();
    localStorage.setItem(UNIT_KEY, unidadeId.trim());
    setSaved(true);
    setErro('');
  }

  function press(d: string) {
    setErro('');
    setPin((p) => (p.length >= 6 ? p : p + d));
  }
  function back() {
    setPin((p) => p.slice(0, -1));
  }

  async function entrar() {
    if (pin.length < 4) {
      setErro('PIN de 4 a 6 dígitos');
      return;
    }
    setLoading(true);
    setErro('');
    try {
      const r = await api.pinLogin(unidadeId, pin);
      setToken(r.access_token);
      router.push('/meu-dia');
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha no PIN');
      setPin('');
    } finally {
      setLoading(false);
    }
  }

  if (!ready) return null;

  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <RegemMark className="mb-2 h-14 w-14 text-foreground" />
          <CardTitle className="text-2xl">Terminal</CardTitle>
          <CardDescription>
            {saved ? 'Digite seu PIN' : 'Configure a unidade do terminal'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!saved ? (
            <form onSubmit={salvarUnidade} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="uid">ID da unidade</Label>
                <Input
                  id="uid"
                  value={unidadeId}
                  onChange={(e) => setUnidadeId(e.target.value)}
                  placeholder="uuid da unidade"
                  required
                />
              </div>
              <Button type="submit" size="lg" className="w-full">
                Salvar unidade
              </Button>
              <p className="text-center text-sm">
                <Link href="/" className="text-primary hover:underline">
                  Entrar com e-mail
                </Link>
              </p>
            </form>
          ) : (
            <div className="space-y-4">
              <div
                className="flex justify-center gap-2 py-2"
                aria-label="PIN digitado"
              >
                {Array.from({ length: 6 }).map((_, i) => (
                  <span
                    key={i}
                    className={`h-3 w-3 rounded-full ${
                      i < pin.length ? 'bg-primary' : 'bg-border'
                    }`}
                  />
                ))}
              </div>
              {erro && (
                <p role="alert" className="text-center text-sm text-destructive">
                  {erro}
                </p>
              )}
              <div className="grid grid-cols-3 gap-2">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
                  <Button
                    key={d}
                    type="button"
                    variant="outline"
                    className="h-14 text-xl"
                    onClick={() => press(d)}
                  >
                    {d}
                  </Button>
                ))}
                <Button
                  type="button"
                  variant="ghost"
                  className="h-14"
                  onClick={back}
                  aria-label="Apagar"
                >
                  <Delete className="h-5 w-5" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-14 text-xl"
                  onClick={() => press('0')}
                >
                  0
                </Button>
                <Button
                  type="button"
                  className="h-14 text-base"
                  onClick={entrar}
                  disabled={loading}
                >
                  {loading ? '…' : 'OK'}
                </Button>
              </div>
              <button
                type="button"
                onClick={() => {
                  localStorage.removeItem(UNIT_KEY);
                  setUnidadeId('');
                  setSaved(false);
                }}
                className="w-full text-center text-xs text-muted-foreground hover:text-foreground"
              >
                Trocar unidade
              </button>
              <p className="text-center text-sm">
                <Link href="/" className="text-primary hover:underline">
                  Entrar com e-mail
                </Link>
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
