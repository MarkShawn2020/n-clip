// Enhanced content type system for Archive Library

export type ContentType = 'text' | 'image' | 'audio' | 'video' | 'document' | 'other'

export interface ContentTypeConfig {
  id: ContentType
  name: string
  icon: string
  extensions: string[]
  mimeTypes: string[]
  layoutType: 'grid' | 'waterfall' | 'list' | 'tiles'
}

export const CONTENT_TYPE_CONFIGS: Record<ContentType, ContentTypeConfig> = {
  text: {
    id: 'text',
    name: '文本',
    icon: '📄',
    extensions: ['.txt', '.md', '.json', '.xml', '.html'],
    mimeTypes: ['text/plain', 'text/markdown', 'application/json', 'text/html'],
    layoutType: 'list'
  },
  image: {
    id: 'image',
    name: '图像',
    icon: '🖼️',
    extensions: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.tiff'],
    mimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'],
    layoutType: 'waterfall'
  },
  audio: {
    id: 'audio',
    name: '音频',
    icon: '🎵',
    extensions: ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.wma', '.m4a'],
    mimeTypes: ['audio/mpeg', 'audio/wav', 'audio/flac', 'audio/aac', 'audio/ogg'],
    layoutType: 'list'
  },
  video: {
    id: 'video',
    name: '视频',
    icon: '🎬',
    extensions: ['.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.mkv', '.m4v'],
    mimeTypes: ['video/mp4', 'video/avi', 'video/quicktime', 'video/webm'],
    layoutType: 'grid'
  },
  document: {
    id: 'document',
    name: '文档',
    icon: '📋',
    extensions: ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx'],
    mimeTypes: ['application/pdf', 'application/msword', 'application/vnd.ms-excel'],
    layoutType: 'list'
  },
  other: {
    id: 'other',
    name: '其他',
    icon: '📦',
    extensions: [],
    mimeTypes: [],
    layoutType: 'grid'
  }
}

// Enhanced ClipboardItem with content type detection
export interface EnhancedClipboardItem {
  id: string
  type: string // legacy field
  contentType: ContentType // new enhanced type
  content: string
  preview?: string
  thumbnail?: string // for optimized display
  metadata?: {
    fileName?: string
    fileExtension?: string
    mimeType?: string
    fileSize?: number
    dimensions?: { width: number; height: number }
    duration?: number // for audio/video
  }
  timestamp: number
  starredAt?: number
  category?: string
  description?: string
  tags?: string[]
}

// Content type detection utilities
export class ContentTypeDetector {
  static detectFromFileName(fileName: string): ContentType {
    const extension = this.getFileExtension(fileName)
    
    for (const [contentType, config] of Object.entries(CONTENT_TYPE_CONFIGS)) {
      if (config.extensions.includes(extension)) {
        return contentType as ContentType
      }
    }
    
    return 'other'
  }
  
  static detectFromMimeType(mimeType: string): ContentType {
    for (const [contentType, config] of Object.entries(CONTENT_TYPE_CONFIGS)) {
      if (config.mimeTypes.some(mime => mimeType.startsWith(mime))) {
        return contentType as ContentType
      }
    }
    
    return 'other'
  }
  
  static detectFromContent(content: string, type: string): ContentType {
    // Legacy type mapping
    if (type === 'image') return 'image'
    if (type === 'file') {
      // Try to detect from content if it looks like a file path
      if (content.includes('.')) {
        return this.detectFromFileName(content)
      }
      return 'document'
    }
    
    // For text, check if it's structured data
    if (this.isJSON(content)) return 'text'
    if (this.isHTML(content)) return 'text'
    if (this.isMarkdown(content)) return 'text'
    
    return 'text'
  }
  
  private static getFileExtension(fileName: string): string {
    return '.' + fileName.split('.').pop()?.toLowerCase() || ''
  }
  
  private static isJSON(content: string): boolean {
    try {
      JSON.parse(content)
      return true
    } catch {
      return false
    }
  }
  
  private static isHTML(content: string): boolean {
    return /<[a-z][\s\S]*>/i.test(content)
  }
  
  private static isMarkdown(content: string): boolean {
    const markdownPatterns = [/^#{1,6}\s/, /\*\*.*\*\*/, /\[.*\]\(.*\)/, /```[\s\S]*```/]
    return markdownPatterns.some(pattern => pattern.test(content))
  }
}

// Layout configuration for different content types
export interface LayoutConfig {
  contentType: ContentType
  columns?: number
  itemSpacing?: number
  itemMinWidth?: number
  itemMaxWidth?: number
  aspectRatio?: number
  showThumbnails?: boolean
  showMetadata?: boolean
}

export const DEFAULT_LAYOUT_CONFIGS: Record<ContentType, LayoutConfig> = {
  text: {
    contentType: 'text',
    showThumbnails: false,
    showMetadata: true
  },
  image: {
    contentType: 'image',
    columns: 3,
    itemSpacing: 16,
    itemMinWidth: 200,
    itemMaxWidth: 300,
    showThumbnails: true,
    showMetadata: false
  },
  audio: {
    contentType: 'audio',
    showThumbnails: false,
    showMetadata: true
  },
  video: {
    contentType: 'video',
    columns: 2,
    itemSpacing: 20,
    itemMinWidth: 300,
    aspectRatio: 16 / 9,
    showThumbnails: true,
    showMetadata: true
  },
  document: {
    contentType: 'document',
    showThumbnails: true,
    showMetadata: true
  },
  other: {
    contentType: 'other',
    columns: 3,
    itemSpacing: 16,
    showThumbnails: false,
    showMetadata: true
  }
}