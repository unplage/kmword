import json

# 读取JSON文件
with open('TOEFL_3.json', 'r', encoding='utf-8') as f:#实际json名字
    content = f.read()

# 解析JSON（每行一个JSON对象）
words = []
for line in content.strip().split('\n'):
    if line.strip():
        data = json.loads(line)
        head_word = data.get('headWord')
        if head_word:
            words.append(head_word)

# 显示结果
print(f"共提取到 {len(words)} 个单词：\n")
print("=" * 60)

# 按每行5个单词的格式输出
for i in range(0, len(words), 5):
    line_words = words[i:i+5]
    print(f"{i+1:3d}-{min(i+5, len(words)):3d}: {', '.join(line_words)}")

# 保存到文件
output_file = '托福260314.txt' #保存的命名
with open(output_file, 'w', encoding='utf-8') as f:
    f.write(f"Level4_2 单词列表\n")
    f.write(f"共 {len(words)} 个单词\n")
    f.write("=" * 60 + "\n\n")
    
    # 按每行一个单词的格式写入
    for i, word in enumerate(words, 1):
        f.write(f"{i:4d}. {word}\n")

print(f"\n单词列表已保存到: {output_file}")
