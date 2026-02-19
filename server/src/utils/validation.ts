import Joi from 'joi';

// Common validation patterns
export const patterns = {
  username: /^[a-zA-Z0-9_-]{3,30}$/,
  password: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[a-zA-Z\d@$!%*?&]{8,}$/,
  displayName: /^[\p{L}\p{N}\s_\-'.]{2,50}$/u,
  roomName: /^[a-zA-Z0-9\s_-]{1,100}$/
};

// User validation schemas
export const userSchemas = {
  register: Joi.object({
    username: Joi.string()
      .pattern(patterns.username)
      .required()
      .messages({
        'string.pattern.base': 'Username can only contain letters, numbers, underscores, and hyphens (3-30 characters)'
      }),
    email: Joi.string()
      .email({ tlds: { allow: false } })
      .required()
      .messages({
        'string.email': 'Please provide a valid email address'
      }),
    password: Joi.string()
      .pattern(patterns.password)
      .required()
      .messages({
        'string.pattern.base': 'Password must be at least 8 characters with uppercase, lowercase, and number'
      }),
    displayName: Joi.string()
      .pattern(patterns.displayName)
      .required()
      .messages({
        'string.pattern.base': 'Display name can contain letters, numbers, spaces, underscores, and hyphens (2-50 characters)'
      }),
    userType: Joi.string()
      .valid('HUMAN', 'AI_ICE', 'AI_LAVA', 'AI_OTHER')
      .default('HUMAN'),
    inviteCode: Joi.string()
      .alphanum()
      .max(20)
      .optional()
      .allow('')
  }),

  login: Joi.object({
    username: Joi.string().required(),
    password: Joi.string().when('userType', {
      is: Joi.string().valid('AI_ICE', 'AI_LAVA', 'AI_OTHER'),
      then: Joi.optional(),
      otherwise: Joi.required()
    }),
    userType: Joi.string()
      .valid('HUMAN', 'AI_ICE', 'AI_LAVA', 'AI_OTHER')
      .default('HUMAN'),
    aiToken: Joi.string().when('userType', {
      is: Joi.string().valid('AI_ICE', 'AI_LAVA', 'AI_OTHER'),
      then: Joi.required(),
      otherwise: Joi.optional()
    })
  }),

  changePassword: Joi.object({
    currentPassword: Joi.string().required(),
    newPassword: Joi.string()
      .pattern(patterns.password)
      .required()
      .messages({
        'string.pattern.base': 'Password must be at least 8 characters with uppercase, lowercase, and number'
      })
  }),

  updateProfile: Joi.object({
    displayName: Joi.string()
      .pattern(patterns.displayName)
      .optional()
      .messages({
        'string.pattern.base': 'Display name can contain letters, numbers, spaces, underscores, and hyphens (2-50 characters)'
      }),
    email: Joi.string()
      .email({ tlds: { allow: false } })
      .optional()
      .messages({
        'string.email': 'Please provide a valid email address'
      }),
    avatar: Joi.string().uri().optional()
  })
};

// Room validation schemas
export const roomSchemas = {
  create: Joi.object({
    name: Joi.string()
      .pattern(patterns.roomName)
      .required()
      .messages({
        'string.pattern.base': 'Room name can contain letters, numbers, spaces, underscores, and hyphens (1-100 characters)'
      }),
    description: Joi.string()
      .max(500)
      .optional()
      .allow(''),
    isPrivate: Joi.boolean().default(false),
    roomType: Joi.string()
      .valid('TRIOLOGUE', 'DIRECT', 'RESEARCH', 'SYSTEM')
      .default('TRIOLOGUE')
  }),

  update: Joi.object({
    name: Joi.string()
      .pattern(patterns.roomName)
      .optional()
      .messages({
        'string.pattern.base': 'Room name can contain letters, numbers, spaces, underscores, and hyphens (1-100 characters)'
      }),
    description: Joi.string()
      .max(500)
      .optional()
      .allow(''),
    isPrivate: Joi.boolean().optional()
  })
};

// Message validation schemas
export const messageSchemas = {
  create: Joi.object({
    content: Joi.string()
      .min(1)
      .max(10000)
      .required()
      .messages({
        'string.min': 'Message cannot be empty',
        'string.max': 'Message cannot exceed 10,000 characters'
      }),
    messageType: Joi.string()
      .valid('TEXT', 'CODE', 'IMAGE', 'FILE', 'SYSTEM', 'AI_RESPONSE', 'RESEARCH_NOTE')
      .default('TEXT'),
    threadId: Joi.string().optional(),
    aiContext: Joi.object().optional(),
    researchTag: Joi.string().max(100).optional()
  }),

  reaction: Joi.object({
    emoji: Joi.string()
      .pattern(/^[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]$/u)
      .required()
      .messages({
        'string.pattern.base': 'Please provide a valid emoji'
      })
  })
};

// File upload validation
export const fileSchemas = {
  upload: Joi.object({
    filename: Joi.string()
      .max(255)
      .required()
      .messages({
        'string.max': 'Filename cannot exceed 255 characters'
      }),
    mimeType: Joi.string()
      .valid(
        // Images
        'image/jpeg', 'image/png', 'image/gif', 'image/webp',
        // Documents
        'application/pdf', 'text/plain', 'text/markdown',
        'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        // Code
        'text/javascript', 'text/css', 'text/html', 'application/json',
        'text/x-python', 'text/x-java-source', 'text/x-csrc'
      )
      .required()
      .messages({
        'any.only': 'File type not supported'
      }),
    size: Joi.number()
      .max(10 * 1024 * 1024) // 10MB limit
      .required()
      .messages({
        'number.max': 'File size cannot exceed 10MB'
      })
  })
};

// Validation middleware factory
export const validate = (schema: Joi.ObjectSchema) => {
  return (req: any, res: any, next: any) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true
    });

    if (error) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.details.map(d => ({
          field: d.path.join('.'),
          message: d.message
        }))
      });
    }

    // Replace req.body with validated and sanitized data
    req.body = value;
    next();
  };
};

// Sanitization helpers
export const sanitize = {
  username: (username: string): string => username.toLowerCase().trim(),
  email: (email: string): string => email.toLowerCase().trim(),
  displayName: (displayName: string): string => displayName.trim(),
  roomName: (name: string): string => name.trim(),
  message: (content: string): string => content.trim()
};

// Security validation
export const security = {
  isValidJWT: (token: string): boolean => {
    try {
      return token.split('.').length === 3;
    } catch {
      return false;
    }
  },

  isSafeFilename: (filename: string): boolean => {
    return !/[<>:"/\\|?*\x00-\x1f]/.test(filename);
  },

  isValidEmoji: (emoji: string): boolean => {
    return /^[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]$/u.test(emoji);
  }
};