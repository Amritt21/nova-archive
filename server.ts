import express from 'express';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

const apiKey = process.env.GEMINI_API_KEY;
let ai: GoogleGenAI | null = null;

if (apiKey) {
  ai = new GoogleGenAI({
    apiKey: apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// Adaptive Explanation Endpoint
app.post('/api/gemini/generate', async (req, res) => {
  const { prompt, depth, topic, baseText } = req.body;
  
  if (!ai) {
    return res.json({
      text: getFallbackExplanation(topic || prompt, depth || 'Standard', baseText),
      isFallback: true,
    });
  }

  try {
    let systemInstruction = '';
    if (depth === 'Simple') {
      systemInstruction = 'Explain this topic in clear, simple, accessible language for someone new to the subject. Use concise paragraphs, clear analogies, and avoid dense jargon.';
    } else if (depth === 'Deep') {
      systemInstruction = 'Provide a comprehensive, scholarly, and nuanced analysis of this topic. Include deep historical or geographical context, chronological milestones, underlying causes and systemic consequences, key terminology, and historiographical perspective.';
    } else {
      systemInstruction = 'Provide a balanced, highly readable encyclopedia entry with context, major dates, key figures, and core developments.';
    }

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: `Topic: ${topic || prompt}\n\nReference Material:\n${baseText ? baseText.slice(0, 3000) : ''}\n\nTask: Generate an explanation at the ${depth || 'Standard'} depth level adhering strictly to verified historical/geographical facts.`,
      config: {
        systemInstruction,
        temperature: 0.3,
      },
    });

    res.json({ text: response.text, isFallback: false });
  } catch (error: any) {
    console.error('Gemini API Error:', error?.message || error);
    res.json({
      text: getFallbackExplanation(topic || prompt, depth || 'Standard', baseText),
      isFallback: true,
      error: error?.message,
    });
  }
});

// Natural Language Search AI Synthesis Endpoint
app.post('/api/gemini/search-answer', async (req, res) => {
  const { query, searchResults } = req.body;

  if (!ai) {
    return res.json({
      answer: `Here is information regarding "${query}". Explore the related historical and geographical entries below for verified details.`,
      intent: classifyIntentFallback(query),
      suggestedTopics: ['Roman Empire', 'World War I', 'Silk Road', 'Himalayas'],
      isFallback: true,
    });
  }

  try {
    const resultsContext = Array.isArray(searchResults)
      ? searchResults.map((r: any) => `Title: ${r.title}\nSnippet: ${r.snippet}`).join('\n---\n')
      : '';

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: `User Query: "${query}"\n\nTop Search Results Context:\n${resultsContext}\n\nProvide a direct, authoritative, grounded answer to the user's question or topic search. Structure with clear bullet points if appropriate. Include 3 suggested follow-up questions at the end under a "FOLLOW_UP_QUESTIONS:" header.`,
      config: {
        systemInstruction: 'You are NOVA ARCHIVE AI, an expert history and geography research synthesis engine. Your answers must be factual, intellectually rigorous, and grounded in historical evidence.',
        temperature: 0.2,
      },
    });

    const fullText = response.text || '';
    const parts = fullText.split('FOLLOW_UP_QUESTIONS:');
    const answer = parts[0].trim();
    const followUpsRaw = parts[1] ? parts[1].trim() : '';
    const suggestedQuestions = followUpsRaw
      ? followUpsRaw.split('\n').map(q => q.replace(/^[-*•\d.]+\s*/, '').trim()).filter(Boolean)
      : ['What were the primary causes?', 'What was the immediate aftermath?', 'How did this impact neighboring regions?'];

    res.json({
      answer,
      suggestedQuestions,
      intent: classifyIntentFallback(query),
      isFallback: false,
    });
  } catch (error: any) {
    console.error('Search Answer Error:', error);
    res.json({
      answer: `NOVA ARCHIVE search synthesized context for "${query}". Please review the curated articles below.`,
      suggestedQuestions: ['What were the key historical factors?', 'Which figures played pivotal roles?'],
      intent: classifyIntentFallback(query),
      isFallback: true,
    });
  }
});

// Ask Nova Contextual Assistant Endpoint
app.post('/api/gemini/ask-nova', async (req, res) => {
  const { articleTitle, articleContext, userQuestion, chatHistory } = req.body;

  if (!ai) {
    return res.json({
      answer: `Regarding **${articleTitle}**: ${userQuestion}\n\nBased on the article context, ${articleTitle} represents a significant subject in this era. For complete primary details, review the citations and timeline sections below.`,
      followUps: ['How did this event impact trade routes?', 'Who were the key commanders or leaders involved?'],
      isFallback: true,
    });
  }

  try {
    const historyText = Array.isArray(chatHistory)
      ? chatHistory.map((m: any) => `${m.role.toUpperCase()}: ${m.text}`).join('\n')
      : '';

    const prompt = `ARTICLE TITLE: ${articleTitle}\n\nARTICLE SUMMARY/CONTEXT:\n${articleContext ? articleContext.slice(0, 4000) : 'No explicit text context.'}\n\nRECENT CHAT HISTORY:\n${historyText}\n\nUSER QUESTION: ${userQuestion}\n\nAnswer the user question concisely and accurately based on the article context. If the question asks for something beyond the article, state what is known historically with academic neutrality. Add a line at the end starting with "SUGGESTIONS:" followed by 2 comma-separated follow-up questions.`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        systemInstruction: 'You are ASK NOVA, the embedded research assistant for NOVA ARCHIVE. Provide precise, objective answers. Cite specific periods, dates, and locations mentioned in the article.',
        temperature: 0.3,
      },
    });

    const fullText = response.text || '';
    const parts = fullText.split('SUGGESTIONS:');
    const answer = parts[0].trim();
    const suggestionsRaw = parts[1] ? parts[1].trim() : '';
    const followUps = suggestionsRaw
      ? suggestionsRaw.split(',').map(s => s.trim()).filter(Boolean)
      : ['What were the diplomatic consequences?', 'How do modern historians evaluate this?'];

    res.json({ answer, followUps, isFallback: false });
  } catch (error: any) {
    console.error('Ask Nova Error:', error);
    res.json({
      answer: `I analyzed your question regarding **${articleTitle}**. According to historical records, this topic was shaped by geographical, economic, and geopolitical forces.`,
      followUps: ['What led to this development?', 'What were the lasting structural outcomes?'],
      isFallback: true,
    });
  }
});

function classifyIntentFallback(query: string): string {
  const q = query.toLowerCase();
  if (q.includes('why') || q.includes('cause') || q.includes('how did') || q.includes('reason')) return 'CAUSE_AND_EFFECT';
  if (q.includes('where') || q.includes('map') || q.includes('border') || q.includes('river') || q.includes('mountain') || q.includes('country')) return 'GEOGRAPHICAL_FEATURE';
  if (q.includes('war') || q.includes('battle') || q.includes('revolution') || q.includes('treaty') || q.includes('fall')) return 'HISTORICAL_EVENT';
  if (q.includes('empire') || q.includes('dynasty') || q.includes('republic') || q.includes('civilization')) return 'CIVILIZATION';
  return 'GENERAL_TOPIC';
}

function getFallbackExplanation(topic: string, depth: string, baseText?: string): string {
  const title = topic.replace(/_/g, ' ');
  if (baseText && baseText.length > 100) {
    if (depth === 'Simple') {
      return `**Simple Overview of ${title}**\n\n${baseText.split('. ').slice(0, 3).join('. ')}.\n\nIn simple terms, ${title} was a pivotal topic in world history. It shaped how people lived, organized society, and interacted with neighboring regions.`;
    } else if (depth === 'Deep') {
      return `**Comprehensive Analysis: ${title}**\n\n${baseText}\n\n### Historical Context & Systemic Implications\nThe developments surrounding ${title} occurred within broader socio-political and economic dynamics. Structural factors including geographic barriers, resource distribution, institutional frameworks, and geopolitical realignments played critical roles in defining its trajectory.`;
    }
    return baseText;
  }

  return `**${title}** is an essential subject in history and geography.\n\nExplore the structured sections, citations, timelines, and interactive maps below to understand its background, key milestones, and historical impact.`;
}

app.listen(3001, () => {
  console.log('NOVA ARCHIVE API Server running on port 3001');
});
