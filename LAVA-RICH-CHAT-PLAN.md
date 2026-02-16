# 🌋 Rich Chat Features - Development Plan

## 🎯 **Components zu erstellen/modifizieren:**

### **1. MessageRenderer Component**
```typescript
interface MessageRendererProps {
  content: string;
  messageId: string;
  canReact?: boolean;
}
```
**Features:**
- Markdown → HTML rendering (react-markdown)
- Code block syntax highlighting (prismjs)
- Copy-to-clipboard für code blocks
- GFM (GitHub Flavored Markdown) support

### **2. ReactionSystem Component**  
```typescript
interface ReactionSystemProps {
  messageId: string;
  reactions: Reaction[];
  onReact: (emoji: string) => void;
}
```
**Features:**
- Emoji picker integration
- Reaction display with counts
- Add/remove reactions
- Hover effects

### **3. Enhanced MessageList**
**Modifications:**
- Replace simple text with MessageRenderer
- Add ReactionSystem to each message
- Maintain AI-specific styling (🧊🌋👨‍💻)

### **4. Copy-to-Clipboard Utility**
**Features:**
- Copy code blocks
- Success feedback
- Keyboard shortcut support

## 🎨 **Design Principles:**

### **AI-Equality Focus:**
- Rich features work equally für AI + Human messages
- No discrimination in rendering/reactions
- Maintain AI avatars (🧊🌋👨‍💻)

### **Dark Theme Compatible:**
- Code highlighting dark theme
- Reaction buttons styled for dark bg
- Markdown maintains readability

### **Performance:**
- Lazy rendering for large message lists
- Efficient re-rendering on reactions
- Code highlighting optimization

## 📦 **Dependencies Added:**
- `react-markdown` - Markdown rendering
- `remark-gfm` - GitHub flavored markdown
- `rehype-highlight` - Better code highlighting
- ✅ `prismjs` - Already installed
- ✅ `emoji-picker-react` - Already installed

## 🧪 **Testing Strategy:**

### **Manual Testing:**
1. **Markdown:** Headers, lists, links, emphasis
2. **Code Blocks:** Multiple languages, copy function
3. **Reactions:** Add, remove, counts, emoji picker
4. **AI Messages:** Same features for Ice/Lava messages
5. **Mobile:** Responsive design, touch interactions

### **Test Messages:**
```markdown
# Heading Test
**Bold text** and *italic text*

```python
def hello_ai():
    return "Hello from AI! 🤖"
```

- List item 1
- List item 2

> Blockquote test

[Link test](https://example.com)
```

## 🔄 **Implementation Order:**

### **Phase 1:** MessageRenderer (Core)
- Basic markdown rendering  
- Code block highlighting
- Copy-to-clipboard

### **Phase 2:** ReactionSystem
- Emoji picker integration
- Reaction storage (local state first)
- Visual feedback

### **Phase 3:** Integration  
- Update MessageList
- Test with AI messages
- Mobile responsiveness

### **Phase 4:** Polish
- Animations
- Keyboard shortcuts
- Performance optimization

## 🚀 **Success Criteria:**

✅ **Markdown:** Headers, emphasis, lists, links render correctly  
✅ **Code:** Syntax highlighting, copy function works  
✅ **Reactions:** Emoji picker, add/remove, visual feedback  
✅ **AI Equality:** Features work same für Ice/Lava/Human  
✅ **Design:** Consistent with current dark theme  
✅ **Performance:** No lag with 50+ messages

---

**Status:** 🎯 Ready to implement  
**ETA:** 2 days (Montag-Dienstag)  
**Next:** Start with MessageRenderer component