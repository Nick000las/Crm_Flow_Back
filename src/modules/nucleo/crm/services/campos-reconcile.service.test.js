import { beforeEach, describe, expect, it, vi } from 'vitest';
import { inserirCamposSistema } from '../adapters/crm-fields.repository.js';
import { CAMPOS_SISTEMA } from '../constants.js';
import { PASSOS_CAMPOS, reconciliarCampos, reconciliarCamposSistema } from './campos-reconcile.service.js';

vi.mock('../adapters/crm-fields.repository.js', () => ({ inserirCamposSistema: vi.fn().mockResolvedValue(0) }));

const TENANT = '00000000-0000-0000-0000-000000000001';

beforeEach(() => vi.clearAllMocks());

describe('reconciliarCamposSistema', () => {
  it('semeia todos os campos do contrato com o padrão de cada um', async () => {
    await reconciliarCamposSistema(TENANT);

    const [[, campos]] = inserirCamposSistema.mock.calls;
    expect(campos).toHaveLength(CAMPOS_SISTEMA.length);
    // Camada 1: visível, obrigatoriedade do contrato.
    expect(campos.find((campo) => campo.systemKey === 'nome')).toMatchObject({ visivel: true, isRequired: true });
    // Camada 2: nasce oculta, o tenant liga.
    expect(campos.find((campo) => campo.systemKey === 'cargo')).toMatchObject({ visivel: false, isRequired: false });
  });

  it('devolve quantos campos nasceram (0 na segunda rodada)', async () => {
    inserirCamposSistema.mockResolvedValueOnce(CAMPOS_SISTEMA.length).mockResolvedValueOnce(0);
    await expect(reconciliarCamposSistema(TENANT)).resolves.toEqual({ criados: CAMPOS_SISTEMA.length });
    await expect(reconciliarCamposSistema(TENANT)).resolves.toEqual({ criados: 0 });
  });

  it('reconciliarCampos roda os passos (hoje só o do sistema)', async () => {
    expect(PASSOS_CAMPOS.map((passo) => passo.nome)).toEqual(['campos-sistema']);
    await reconciliarCampos(TENANT);
    expect(inserirCamposSistema).toHaveBeenCalledTimes(1);
  });
});
