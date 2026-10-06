/**
 * Chaves de cache e invalidação das telas que leem atividade.
 *
 * A atividade aparece em três lugares ao mesmo tempo: o chat da lavoura, a
 * lista global de atividades e o dashboard. Antes elas usavam chaves soltas
 * (`['atividades', id]` no chat, `['feed']` nas outras duas), então criar uma
 * atividade no chat invalidava só o cache do chat e a lista global continuava
 * mostrando o estado antigo — a pessoa via a mensagem no chat e a tela de
 * atividades sem a mensagem nova.
 *
 * `invalidarAtividades` centraliza a lista de Affected. Adicionar uma tela nova
 * que leia atividade é acrescentar a chave aqui, não lembrar de invalidar.
 */
export const QUERY = {
  /** Chat de uma lavoura. O id entra como number: '2' e 2 são caches distintos. */
  chat: (idLavoura: number) => ['atividades', idLavoura] as const,
  /** Lista global de atividades e dashboard (mesma consulta, mesmo dado). */
  feed: () => ['feed'] as const,
  /** Galeria do perfil da lavoura. */
  midia: (idLavoura: number) => ['lavouras', idLavoura, 'media'] as const,
  /**
   * Lista de lavouras: a view `lavoura_com_ultima_atividade` calcula o
   * `ultima_atividade_date` no banco, então criar ou apagar atividade muda o que
   * a lista de lavouras mostra.
   */
  lavouras: () => ['lavouras'] as const,
} as const;

/**
 * Invalida todo cache derivado de atividade. Chamar depois de qualquer
 * create/update/delete de atividade.
 */
export function invalidarAtividades(
  queryClient: { invalidateQueries: (f: { queryKey: readonly unknown[] }) => Promise<unknown> },
  idLavoura?: number | null,
): Promise<unknown>[] {
  const afetadas = [
    queryClient.invalidateQueries({ queryKey: QUERY.feed() }),
    queryClient.invalidateQueries({ queryKey: QUERY.lavouras() }),
  ];

  if (idLavoura) {
    afetadas.push(queryClient.invalidateQueries({ queryKey: QUERY.chat(idLavoura) }));
    afetadas.push(queryClient.invalidateQueries({ queryKey: QUERY.midia(idLavoura) }));
  }

  return afetadas;
}