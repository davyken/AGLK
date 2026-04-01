import { Injectable } from '@nestjs/common';

@Injectable()
export class TranslationService {
  private translations = {
    english: {
      // Registration
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

      // Language
      selectLanguage: '🌐 Select your preferred language:\n1️⃣ English\n2️⃣ Français (French)\n3️⃣ Pidgin',
      languageSet: '✅ Language set to English',
      invalidLanguage: '❌ Please reply 1, 2, or 3 to select language.',

      // Help
      helpTitle: '📋 FarmerConnect Help',
      farmerCommands: '👨‍🌾 Farmer commands:',
      buyerCommands: '🏪 Buyer commands:',
      tips: '💡 Tips:',
      helpReply: 'Reply HELP anytime to see this menu.',

      // Listing
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

      // Buy
      foundListings: (count: number, product: string) => `🔍 Found ${count} farmer(s) with ${product}`,
      replyToSelect: 'Reply with the number to select a farmer.',
      noListingsFound: '🔍 *No listings found for',
      requestSaved: 'Your request has been saved.',
      requestId: '📋 Request ID',
      notifyWhenAvailable: "We'll notify you when farmers list this product.",

      // Match
      newInterest: '🔔 *New Buyer Interest!*',
      buyerWants: 'A buyer wants your produce:',
      budget: 'Budget',
      respondYesNo: 'To respond, reply YES or NO.',

      // General
      somethingWrong: '❌ Something went wrong. Start fresh with a new command.',
      notRegistered: '❌ You need to register first.\n\nReply Hi to start registration.',
      onlyFarmers: (role: string) => `❌ Only farmers can sell. You are registered as a ${role}.`,
      onlyBuyers: (role: string) => `❌ Only buyers can buy. You are registered as a ${role}.`,
      invalidFormat: '❌ Invalid format.\n\nUse: SELL maize 10 bags',
      invalidResponse: '❌ Invalid response.\n\nReply 1 or 2',
      imageReceived: '📷 Image received!\n\nTo add this image to your listing, use:\nSELL maize 10 bags\n\nThen reply with this image after entering the price.',
      voiceReceived: '🎤 Voice note received and processed!',
    },

    french: {
      // Registration
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

      // Language
      selectLanguage: '🌐 Sélectionnez votre langue préférée :\n1️⃣ English (Anglais)\n2️⃣ Français\n3️⃣ Pidgin',
      languageSet: '✅ Langue définie sur Français',
      invalidLanguage: '❌ Veuillez répondre 1, 2 ou 3 pour sélectionner la langue.',

      // Help
      helpTitle: '📋 Aide FarmerConnect',
      farmerCommands: '👨‍🌾 Commandes Agriculteur :',
      buyerCommands: '🏪 Commandes Acheteur :',
      tips: '💡 Conseils :',
      helpReply: 'Répondez AIDE pour voir ce menu.',

      // Listing
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

      // Buy
      foundListings: (count: number, product: string) => `🔍 Trouvé ${count} agriculteur(s) avec ${product}`,
      replyToSelect: 'Répondez avec le numéro pour sélectionner un agriculteur.',
      noListingsFound: '🔍 *Aucune annonce trouvée pour',
      requestSaved: 'Votre demande a été enregistrée.',
      requestId: '📋 ID de la demande',
      notifyWhenAvailable: 'Nous vousNotifierons lorsque les agriculteurs listeront ce produit.',

      // Match
      newInterest: '🔔 *Nouvel intérêt d\'acheteur !*',
      buyerWants: 'Un acheteur veut vos produits :',
      budget: 'Budget',
      respondYesNo: 'Pour répondre, répondez OUI ou NON.',

      // General
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
      // Registration
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

      // Language
      selectLanguage: '🌐 Choose your language:\n1️⃣ English\n2️⃣ Français (French)\n3️⃣ Pidgin',
      languageSet: '✅ Language don set to Pidgin',
      invalidLanguage: '❌ Please reply 1, 2, or 3.',

      // Help
      helpTitle: '📋 FarmerConnect Help',
      farmerCommands: '👨‍🌾 Farmer commands:',
      buyerCommands: '🏪 Buyer commands:',
      tips: '💡 Tips:',
      helpReply: 'Type HELP for this menu.',

      // Listing
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

      // Buy
      foundListings: (count: number, product: string) => `🔍 Found ${count} farmer(s) with ${product}`,
      replyToSelect: 'Reply number to pick farmer.',
      noListingsFound: '🔍 *No listings found for',
      requestSaved: 'Your request don save.',
      requestId: '📋 Request ID',
      notifyWhenAvailable: 'We go notify you when farmers list this product.',

      // Match
      newInterest: '🔔 *Buyer Dey Interest!*',
      buyerWants: 'One buyer want your produce:',
      budget: 'Budget',
      respondYesNo: 'To answer, reply YES or NO.',

      // General
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
      t.farmerCommands,
      'SELL maize 10 bags',
      '  Then send picture of your product!',
      '',
      t.buyerCommands,
      'BUY maize 20 bags',
      'BUY maize 20 bags @yaounde (filter by city)',
      'BUY maize 20 bags #10000-20000 (price range)',
      'BUY maize 20 bags @yaounde #15000-25000 (city + price)',
      '',
      t.tips,
      '- Use @ before city name to filter by location',
      '- Use #min-max for price range',
      '- Add picture when selling to attract buyers!',
      '',
      t.helpReply,
    ].join('\n');
  }
}
