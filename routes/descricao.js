const express = require('express');
const router = express.Router();
const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

// Schema que garante dois campos distintos
const responseSchema = {
  type: "object",
  properties: {
    introducao: { type: "string" },       // parágrafo curto de apresentação
    especificacoes: {
      type: "array",
      items: { type: "string" },
      minItems: 1
    }
  },
  required: ["introducao", "especificacoes"]
};

router.post('/gerar-descricao', async (req, res) => {
  try {
    const { nome, shape, marca, tipo, categoria, caracteristicas = "" } = req.body || {};

    if (!nome || !marca || !tipo || !categoria) {
      return res.status(400).json({ error: 'Campos obrigatórios: nome, marca, tipo, categoria.' });
    }

    const caracteristicasClean = String(caracteristicas || '').slice(0, 2000);

    const systemInstruction = `
Você é um especialista em redação de anúncios para marketplace de instrumentos musicais.
Sua tarefa: criar um texto, apresentando o item em questão, dividido em duas partes.

Parte 1: "introducao" (parágrafo único, 80–120 palavras)
- Apresente o instrumento de forma breve e cativante.
- Inclua marca, modelo, tipo, categoria e possíveis usos.
- Pode mencionar brevemente um ou dois destaques.
- Faça um texto sem juizo de valor do item, foque apenas em caracteristicas técnicas.

Parte 2: "especificacoes" (lista)
- Extraia fielmente TODAS as especificações técnicas do texto fornecido pelo vendedor.
- Mantenha medidas, materiais e nomes originais.
- Liste cada especificação em um item curto, no formato "Chave: valor".

Nunca invente informações não citadas.
Se o texto não se referir a itens do ramo da músicas, responda com "Não foi possivel gerar a descrição a partir deste texto.".
`.trim();

    const prompt = `
Gere APENAS JSON válido conforme o schema, com os campos "introducao" e "especificacoes".

Dados do produto:
- Nome: ${nome}
- Marca: ${marca}
- Tipo: ${tipo} (Define que tipo de instrumento é. Ou se é um acessório.)
- Categoria: ${categoria} 
- Shape/Modelo: ${shape || 'n/d'}

Texto do vendedor:
"""
${caracteristicasClean || 'n/d'}
"""
`.trim();

    const model = genAI.getGenerativeModel({
      model: MODEL,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema
      },
      systemInstruction
    });

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }]
    });

    const raw = result.response.text();
    let parsed;
    try { parsed = JSON.parse(raw); } catch {}

    if (!parsed?.introducao || !parsed?.especificacoes) {
      return res.status(500).json({ error: 'Falha ao gerar descrição no formato esperado.' });
    }

    // Junta introdução + especificações em um texto final (se quiser salvar pronto)
    const descricaoFinal = `${parsed.introducao}\n\nEspecificações:\n${parsed.especificacoes.map(s => `- ${s}`).join('\n')}`;

    return res.json({
      descricao: descricaoFinal,
      introducao: parsed.introducao,
      especificacoes: parsed.especificacoes
    });

  } catch (err) {
    console.error('Erro /gerar-descricao:', err);
    return res.status(500).json({ error: 'Erro ao gerar descrição.' });
  }
});

module.exports = router;
