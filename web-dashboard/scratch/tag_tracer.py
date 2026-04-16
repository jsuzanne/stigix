import re

def analyze_full_balance(filename):
    with open(filename, 'r') as f:
        content = f.read()
    
    lines = content.splitlines()
    
    div_stack = []
    brace_stack = []
    
    # Regex to find all tokens in order
    tokens = re.finditer(r'<div(?![^>]*?/>)[^>]*?>|</div>|{|}|<div[^>]*?/>', content, re.DOTALL)
    
    for match in tokens:
        token = match.group(0)
        pos = match.start()
        # Find line number (inefficient but simple)
        line_num = content[:pos].count('\n') + 1
        
        if token == '</div>':
            if div_stack:
                div_stack.pop()
            else:
                print(f"Extra </div> at line {line_num}")
        elif token.startswith('<div') and not token.endswith('/>'):
            div_stack.append(line_num)
        elif token == '{':
            brace_stack.append(line_num)
        elif token == '}':
            if brace_stack:
                brace_stack.pop()
            else:
                print(f"Extra }} at line {line_num}")
                
    for line in div_stack:
        print(f"Unclosed <div from line {line}")
    for line in brace_stack:
        print(f"Unclosed {{ from line {line}")

if __name__ == "__main__":
    analyze_full_balance("src/Settings.tsx")
