FROM python:3.11-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY requirements.txt .
RUN python -m pip install --upgrade pip \
    && python -m pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu \
    && python -c "import torch; assert torch.version.cuda is None, torch.version.cuda" \
    && python -m pip install --no-cache-dir -r requirements.txt
COPY app app
RUN mkdir -p models
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
