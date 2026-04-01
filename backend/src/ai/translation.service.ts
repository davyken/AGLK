import { Injectable } from '@nestjs/common';

@Injectable()
export class TranslationService {
  private translations = {
    english: {
      welcome: '👋 Welcome to AGRO-LINK!',
      chooseRole: 'Are you a:\n1️⃣ Farmer (I sell produce)\n2️⃣ Buyer (I buy produce)',
      invalidRole: '❌ Please reply 1 for Farmer or 2 for Buyer.',
      enterName: 'What is your full name?',
      invalidName: '❌ Please enter a valid name.',
      enterLocation: '📍 What is your location? (e.g. Yaoundé, Bafoussam)',
      invalidLocation: '❌ Please enter a valid location.',
      enterProduces: '🌱 What do you grow? Separate by commas.\n\nExample: maize, cassava, tomatoes',
      enterBusiness: '🏪 What is your business name?',
      enterNeeds: '🛒 What products do you need? Separate by commas.\n\nExample: maize, tomatoes, plantain',
      registeredFarmer: (name: string) => `✅ You are registered as a Farmer!\n\nWelcome ${name} 👨‍🌾\n\nTo list produce, type:\nSELL maize 10 bags\n\nType HELP anytime for options.`,
      registeredBuyer: (name: string) => `✅ You are registered as a Buyer!\n\nWelcome ${name} 🏪\n\nTo find produce, type:\nBUY maize 20 bags\n\nType HELP anytime for options.`,
      selectLanguage: '🌐 Select your preferred language:\n1️⃣ English\n2️⃣ Français (French)\n3️⃣ Pidgin',
      languageSet: '✅ Language set to English',
      languageChanged: (lang: string) => `✅ Language set to ${lang}`,
      invalidLanguage: '❌ Please reply 1, 2, or 3 to select language.',
      helpTitle: '📋 Agro-link Help',
      helpFarmer: 'SELL maize 10 bags',
      helpFarmerTip: '  Then send picture of your product!',
      helpBuyer: 'BUY maize 20 bags',
      helpFilterCity: 'BUY maize 20 bags @yaounde (filter by city)',
      helpFilterPrice: 'BUY maize 20 bags #10000-20000 (price range)',
      helpFilterBoth: 'BUY maize 20 bags @yaounde #15000-25000 (city + price)',
      tips: '💡 Tips:',
      tipCity: '- Use @ before city name to filter by location',
      tipPrice: '- Use #min-max for price range (e.g. #10000-20000)',
      tipImage: '- Add an image when selling to attract buyers!',
      helpLanguage: 'LANGUAGE - change language (English/French/Pidgin)',
      helpReply: 'Reply HELP anytime to see this menu.',
      marketPrice: (product: string) => `📊 *Market Price for ${product}*`,
      low: 'Low',
      average: 'Average',
      high: 'High',
      suggested: 'Suggested',
      acceptPrice: 'Accept suggested price',
      setCustomPrice: 'Set custom price',
      replyOptions: 'Reply 1 or 2',
      addImageTip: 'Optional: 📷 Send an image of your product after setting the price!',
      enterCustomPrice: '💰 Please enter your custom price.\n\nExample: 20000',
      listingCreated: '✅ *Listing Created!*',
      product: '🌽 Product',
      quantity: 'Quantity',
      price: 'Price',
      location: 'Location',
      listingId: '📋 Listing ID',
      imageAdded: '📷 Photo added to listing!',
      typeHelp: 'Type HELP for more options.',
      foundListings: (count: number, product: string) => `🔍 Found ${count} farmer(s) with ${product}`,
      replyToSelect: 'Reply with the number to select a farmer.',
      noListingsFound: '🔍 *No listings found for',
      requestSaved: 'Your request has been saved.',
      requestId: '📋 Request ID',
      notifyWhenAvailable: "We'll notify you when farmers list this product.",
      newInterest: '🔔 *New Buyer Interest!*',
      buyerWants: 'A buyer wants your produce:',
      budget: 'Budget',
      respondYesNo: 'To respond, reply YES or NO.',
      somethingWrong: '❌ Something went wrong. Start fresh with a new command.',
      notRegistered: '❌ You need to register first.\n\nReply Hi to start registration.',
      onlyFarmers: (role: string) => `❌ Only farmers can sell. You are registered as ${role}.`,
      onlyBuyers: (role: string) => `❌ Only buyers can buy. You are registered as ${role}.`,
      invalidFormat: '❌ Invalid format.\n\nUse: SELL maize 10 bags',
      invalidResponse: '❌ Invalid response.\n\nReply 1 or 2',
      imageReceived: '📷 Image received!\n\nTo add this image to your listing, use:\nSELL maize 10 bags\n\nThen reply with this image after entering the price.',
      voiceReceived: '🎤 Voice note received and processed!',
    },

    french: {
      welcome: '👋 Bienvenue sur AGRO-LINK !',
      chooseRole: 'Êtes-vous :\n1️⃣ Agriculteur (je vends des produits)\n2️⃣ Acheteur (j\'achète des produits)',
      invalidRole: '❌ Veuillez répondre 1 pour Agriculteur ou 2 pour Acheteur.',
      enterName: 'Quel est votre nom complet ?',
      invalidName: '❌ Veuillez entrer un nom valide.',
      enterLocation: '📍 Quelle est votre localisation ? (ex: Yaoundé, Bafoussam)',
      invalidLocation: '❌ Veuillez entrer une localisation valide.',
      enterProduces: '🌱 Que cultivez-vous ? Séparez par des virgules.\n\nExemple: maïs, manioc, tomates',
      enterBusiness: '🏪 Quel est le nom de votre entreprise ?',
      enterNeeds: '🛒 De quels produits avez-vous besoin ? Séparez par des virgules.\n\nExemple: maize, tomates, plantain',
      registeredFarmer: (name: string) => `✅ Vous êtes enregistré comme Agriculteur !\n\nBienvenue ${name} 👨‍🌾\n\nPour lister des produits, tapez :\nVENDRE maize 10 sacs\n\nTapez AIDE pour les options.`,
      registeredBuyer: (name: string) => `✅ Vous êtes enregistré comme Acheteur !\n\nBienvenue ${name} 🏪\n\nPour trouver des produits, tapez :\nACHETER maize 20 sacs\n\nTapez AIDE pour les options.`,
      selectLanguage: '🌐 Sélectionnez votre langue préférée :\n1️⃣ English (Anglais)\n2️⃣ Français\n3️⃣ Pidgin',
      languageSet: '✅ Langue définie sur Français',
      languageChanged: (lang: string) => `✅ Langue définie sur ${lang}`,
      invalidLanguage: '❌ Veuillez répondre 1, 2 ou 3 pour sélectionner la langue.',
      helpTitle: '📋 Aide Agro-link',
      helpFarmer: 'VENDRE maize 10 sacs',
      helpFarmerTip: '  Ensuite envoyez une image de votre produit !',
      helpBuyer: 'ACHETER maize 20 sacs',
      helpFilterCity: 'ACHETER maize 20 sacs @yaounde (filtrer par ville)',
      helpFilterPrice: 'ACHETER maize 20 sacs #10000-20000 (fourchette de prix)',
      helpFilterBoth: 'ACHETER maize 20 sacs @yaounde #15000-25000 (ville + prix)',
      tips: '💡 Conseils :',
      tipCity: '- Utilisez @ avant le nom de la ville pour filtrer par localisation',
      tipPrice: '- Utilisez #min-max pour la fourchette de prix (ex: #10000-20000)',
      tipImage: '- Ajoutez une image lors de la vente pour attirer les acheteurs !',
      helpLanguage: 'LANGUE - changer la langue (Anglais/Français/Pidgin)',
      helpReply: 'Répondez AIDE pour voir ce menu.',
      marketPrice: (product: string) => `📊 *Prix du marché pour ${product}*`,
      low: 'Bas',
      average: 'Moyen',
      high: 'Haut',
      suggested: 'Suggéré',
      acceptPrice: 'Accepter le prix suggéré',
      setCustomPrice: 'Définir un prix personnalisé',
      replyOptions: 'Répondez 1 ou 2',
      addImageTip: 'Optionnel : 📷 Envoyez une image de votre produit après avoir défini le prix !',
      enterCustomPrice: '💰 Veuillez entrer votre prix personnalisé.\n\nExemple: 20000',
      listingCreated: '✅ *Annonce créée !*',
      product: '🌽 Produit',
      quantity: 'Quantité',
      price: 'Prix',
      location: 'Localisation',
      listingId: '📋 ID de l\'annonce',
      imageAdded: '📷 Photo ajoutée à l\'annonce !',
      typeHelp: 'Tapez AIDE pour plus d\'options.',
      foundListings: (count: number, product: string) => `🔍 Trouvé ${count} agriculteur(s) avec ${product}`,
      replyToSelect: 'Répondez avec le numéro pour sélectionner un agriculteur.',
      noListingsFound: '🔍 *Aucune annonce trouvée pour',
      requestSaved: 'Votre demande a été enregistrée.',
      requestId: '📋 ID de la demande',
      notifyWhenAvailable: 'Nous vousNotifierons lorsque les agriculteurs listeront ce produit.',
      newInterest: '🔔 *Nouvel intérêt d\'acheteur !*',
      buyerWants: 'Un acheteur veut vos produits :',
      budget: 'Budget',
      respondYesNo: 'Pour répondre, répondez OUI ou NON.',
      somethingWrong: '❌ Quelque chose s\'est mal passé. Recommencez avec une nouvelle commande.',
      notRegistered: '❌ Vous devez d\'abord vous enregistrer.\n\nRépondez Salut pour commencer.',
      onlyFarmers: (role: string) => `❌ Seuls les agriculteurs peuvent vendre. Vous êtes enregistré comme ${role}.`,
      onlyBuyers: (role: string) => `❌ Seuls les acheteurs peuvent acheter. Vous êtes enregistré comme ${role}.`,
      invalidFormat: '❌ Format invalide.\n\nUtilisez : VENDRE maize 10 sacs',
      invalidResponse: '❌ Réponse invalide.\n\nRépondez 1 ou 2',
      imageReceived: '📷 Image reçue !\n\nPour ajouter cette image à votre annonce, utilisez :\nVENDRE maize 10 sacs\n\nPuis répondez avec cette image après avoir entré le prix.',
      voiceReceived: '🎤 Message vocal reçu et traité !',
    },

    pidgin: {
      welcome: '👋 Welcome to AGRO-LINK!',
      chooseRole: 'You be:\n1️⃣ Farmer (I sell produce)\n2️⃣ Buyer (I buy produce)',
      invalidRole: '❌ Please reply 1 for Farmer or 2 for Buyer.',
      enterName: 'Wetin be your full name?',
      invalidName: '❌ Please enter valid name.',
      enterLocation: '📍 Where you dey? (e.g. Yaoundé, Bafoussam)',
      invalidLocation: '❌ Please enter valid location.',
      enterProduces: '🌱 Wetin you grow? Separate by commas.\n\nExample: maize, cassava, tomatoes',
      enterBusiness: '🏪 Wetin be your business name?',
      enterNeeds: '🛒 Wetin you need? Separate by commas.\n\nExample: maize, tomatoes, plantain',
      registeredFarmer: (name: string) => `✅ You don register as Farmer!\n\nWelcome ${name} 👨‍🌾\n\nTo list produce, type:\nSELL maize 10 bags\n\nType HELP for options.`,
      registeredBuyer: (name: string) => `✅ You don register as Buyer!\n\nWelcome ${name} 🏪\n\nTo find produce, type:\nBUY maize 20 bags\n\nType HELP for options.`,
      selectLanguage: '🌐 Choose your language:\n1️⃣ English\n2️⃣ Français (French)\n3️⃣ Pidgin',
      languageSet: '✅ Language don set to Pidgin',
      languageChanged: (lang: string) => `✅ Language don set to ${lang}`,
      invalidLanguage: '❌ Please reply 1, 2, or 3.',
      helpTitle: '📋 Agro-link Help',
      helpFarmer: 'SELL maize 10 bags',
      helpFarmerTip: '  Then send picture of your product!',
      helpBuyer: 'BUY maize 20 bags',
      helpFilterCity: 'BUY maize 20 bags @yaounde (filter by city)',
      helpFilterPrice: 'BUY maize 20 bags #10000-20000 (price range)',
      helpFilterBoth: 'BUY maize 20 bags @yaounde #15000-25000 (city + price)',
      tips: '💡 Tips:',
      tipCity: '- Use @ before city name to filter by location',
      tipPrice: '- Use #min-max for price range',
      tipImage: '- Add picture when selling to attract buyers!',
      helpLanguage: 'LANGUAGE - change language (English/French/Pidgin)',
      helpReply: 'Type HELP for this menu.',
      marketPrice: (product: string) => `📊 *Market Price for ${product}*`,
      low: 'Low',
      average: 'Average',
      high: 'High',
      suggested: 'Suggested',
      acceptPrice: 'Accept suggested price',
      setCustomPrice: 'Set your price',
      replyOptions: 'Reply 1 or 2',
      addImageTip: 'Optional: 📷 Send picture of your product after setting price!',
      enterCustomPrice: '💰 Enter your price.\n\nExample: 20000',
      listingCreated: '✅ *Listing Don Create!*',
      product: '🌽 Product',
      quantity: 'Quantity',
      price: 'Price',
      location: 'Location',
      listingId: '📋 Listing ID',
      imageAdded: '📷 Picture don add to listing!',
      typeHelp: 'Type HELP for more options.',
      foundListings: (count: number, product: string) => `🔍 Found ${count} farmer(s) with ${product}`,
      replyToSelect: 'Reply number to pick farmer.',
      noListingsFound: '🔍 *No listings found for',
      requestSaved: 'Your request don save.',
      requestId: '📋 Request ID',
      notifyWhenAvailable: 'We go notify you when farmers list this product.',
      newInterest: '🔔 *Buyer Dey Interest!*',
      buyerWants: 'One buyer want your produce:',
      budget: 'Budget',
      respondYesNo: 'To answer, reply YES or NO.',
      somethingWrong: '❌ Something naim wrong. Start fresh.',
      notRegistered: '❌ You need register first.\n\nReply Hi to start.',
      onlyFarmers: (role: string) => `❌ Only farmers fit sell. You don register as ${role}.`,
      onlyBuyers: (role: string) => `❌ Only buyers fit buy. You don register as ${role}.`,
      invalidFormat: '❌ Wrong format.\n\nUse: SELL maize 10 bags',
      invalidResponse: '❌ Wrong response.\n\nReply 1 or 2',
      imageReceived: '📷 Picture don receive!',
      voiceReceived: '🎤 Voice message don process!',
    },
  };

  // Keywords for language detection
  private frenchKeywords = [
    'bonjour', 'bonsoir', 'je', 'vous', 'vouloir', 'acheter', 'vendre',
    'produit', 'mais', 'manioc', 'tomate', 'prix', 'quantité', 'sac',
    'sacs', ' localisation', 'enregistrer', 'merci', 'oui', 'non',
    'agriculteur', 'acheteur', 'bienvenue', 'être', 'comment', 's\'il',
    'vous plaît', 'merci', 'aide', 'trouver', 'chercher', 'disponible',
  ];

  private pidginKeywords = [
    'you', 'don', 'dey', 'fit', 'wana', 'want', 'buy', 'sell',
    'maize', 'cassava', 'tomatoes', 'price', 'bags', 'where',
    'na', 'for', 'make', 'e.g', 'e.g.', 'naim', 'wetin', 'hello',
    'hi', 'go', 'go be', 'your', 'my', 'give', 'abeg', 'pls', 'please',
    'dis', 'dat', 'get', 'got', 'no', 'yes', '号', 'we', 'go', 'come',
  ];

  /**
   * Auto-detect language from user message
   */
  detectLanguage(text: string): string {
    const lowerText = text.toLowerCase();
    
    let frenchScore = 0;
    let pidginScore = 0;

    // Check French keywords
    for (const keyword of this.frenchKeywords) {
      if (lowerText.includes(keyword)) {
        frenchScore++;
      }
    }

    // Check Pidgin keywords
    for (const keyword of this.pidginKeywords) {
      if (lowerText.includes(keyword)) {
        pidginScore++;
      }
    }

    // Determine language based on scores
    if (frenchScore > pidginScore && frenchScore >= 2) {
      return 'french';
    }

    if (pidginScore > frenchScore && pidginScore >= 2) {
      return 'pidgin';
    }

    // Default to English
    return 'english';
  }

  /**
   * Get translation for a key in the specified language
   */
  t(language: string, key: string, ...args: any[]): string {
    const lang = (language || 'english') as keyof typeof this.translations;
    const translations = this.translations[lang] || this.translations.english;
    
    const translation = (translations as any)[key];
    
    if (typeof translation === 'function') {
      return translation(...args);
    }
    
    return translation || key;
  }

  /**
   * Get all help text for a language
   */
  getHelpText(language: string): string {
    const lang = (language || 'english') as keyof typeof this.translations;
    const t = this.translations[lang] || this.translations.english;
    
    return [
      t.helpTitle,
      '',
      '👨‍🌾 Farmer commands:',
      t.helpFarmer,
      t.helpFarmerTip,
      '',
      '🏪 Buyer commands:',
      t.helpBuyer,
      t.helpFilterCity,
      t.helpFilterPrice,
      t.helpFilterBoth,
      '',
      '🌐 Language:',
      t.helpLanguage,
      '',
      t.tips,
      t.tipCity,
      t.tipPrice,
      t.tipImage,
      '',
      t.helpReply,
    ].join('\n');
  }
}
