FROM pytorch/pytorch:2.2.2-cuda12.1-cudnn8-devel

# Non-interactive defaults — prevent tools from blocking on stdin prompts
# when run inside Jupyter notebook cells.
ENV DEBIAN_FRONTEND=noninteractive \
    UV_VENV_CLEAR=1 \
    PIP_NO_INPUT=1 \
    PIP_ROOT_USER_ACTION=ignore \
    PYTHONDONTWRITEBYTECODE=1

# Basic tools
RUN apt-get update && apt-get install -y git curl

# Create a default environment
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Core packages (minimal, not opinionated)
RUN pip install --upgrade pip \
    && pip install jupyterlab ipykernel

# Register kernel
RUN python -m ipykernel install --name base --display-name "Python (Base GPU)"

WORKDIR /workspace